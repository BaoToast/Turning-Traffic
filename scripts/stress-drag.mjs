import { chromium } from "playwright";
import { readFileSync, existsSync, statSync } from "node:fs";
import http from "node:http";
import { join, extname } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromiumLaunchOptions } from "./chromium.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2];
const LABEL = process.argv[3];
const MIME = {".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png"};
const server = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split("?")[0]); if(p==="/")p="/index.html";
  const f=join(ROOT,p); if(!existsSync(f)||statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"}); res.end(readFileSync(f)); });
await new Promise(r=>server.listen(8112,r));
const seed = readFileSync(join(here, "seed-state.json"),"utf8");
const b = await chromium.launch(chromiumLaunchOptions());
const page = await (await b.newContext({viewport:{width:1680,height:1050},locale:"zh-TW"})).newPage();
let crashed=false, errs=0;
page.on("crash",()=>{crashed=true});
page.on("pageerror",e=>{errs++; if(errs<3) console.log("  ERR:", e.message.slice(0,90))});
await page.addInitScript(s=>localStorage.setItem("turning-traffic-state-v2",s), seed);
await page.goto("http://localhost:8112/"); await page.waitForTimeout(1500);
// 7叉路口 + 開啟排版預覽
await page.locator('aside button:has-text("路口轉向圖"), nav button:has-text("路口轉向圖")').first().click();
await page.waitForTimeout(1000);
try { await page.locator("select").filter({hasText:"岡山交流道"}).first().selectOption({label:"台1－岡山交流道路口"}); } catch { console.log("  (無法切7叉)"); }
await page.waitForTimeout(1200);
const PREVIEW = process.argv[4] === "preview";
if (PREVIEW) {
  await page.locator('aside button:has-text("道路與流向管理"), nav button:has-text("道路與流向管理")').first().click();
  await page.waitForTimeout(1200);
  const openPreview = page.locator('button:has-text("開啟圖卡排版預覽")');
  if (await openPreview.count()) { await openPreview.first().click(); await page.waitForTimeout(1500); }
}
const canvasSel = PREVIEW ? ".geometry-card-preview-canvas [data-card-id]" : ".diagram-canvas [data-card-id]";
const n = await page.locator(canvasSel).count();
console.log(`[${LABEL}] 預覽圖卡數:`, n);
if (!n) { console.log(`[${LABEL}] 找不到可拖曳圖卡`); await b.close(); server.close(); process.exit(0); }
await page.evaluate(()=>{ window.__writes=0; const orig=Storage.prototype.setItem;
  Storage.prototype.setItem=function(...a){ window.__writes++; return orig.apply(this,a); }; });
await page.locator(canvasSel).first().scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const box = await page.locator(canvasSel).first().boundingBox();
console.log(`[${LABEL}] 拖曳起點`, Math.round(box.x), Math.round(box.y));
const t0 = Date.now();
await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
await page.mouse.down();
let steps=0;
try {
  for (let i=0;i<300;i++){
    const a=(i/300)*Math.PI*6;
    await page.mouse.move(box.x+box.width/2+Math.cos(a)*100, box.y+box.height/2+Math.sin(a)*60, {timeout:4000});
    steps++;
    if (Date.now()-t0 > 60000) { console.log(`[${LABEL}] 超過 60 秒仍未完成，中止`); break; }
  }
  await page.mouse.up();
} catch(e){ console.log(`[${LABEL}] 拖曳中斷於第 ${steps} 步：`, e.message.slice(0,80)); }
const elapsed = Date.now()-t0;
let alive=0, store={bytes:0,revisions:0};
try { alive = await page.evaluate(()=>document.querySelectorAll("[data-card-id]").length, {timeout:5000}); } catch { alive=-1; }
try { store = await page.evaluate(()=>{const raw=localStorage.getItem("turning-traffic-state-v2")||"";const j=JSON.parse(raw||"{}");return {bytes:raw.length,revisions:(j.recordRevisions||[]).length};}, {timeout:5000}); } catch { /* 壓力測試允許讀不到瀏覽器儲存資訊 */ }
console.log(`[${LABEL}] ${steps} 步 / ${elapsed}ms / 每步 ${(elapsed/Math.max(1,steps)).toFixed(0)}ms / 存活圖卡 ${alive} / crashed=${crashed} / pageerrors=${errs}`);
const writes = await page.evaluate(()=>window.__writes).catch(()=>-1);
console.log(`[${LABEL}] localStorage ${Math.round(store.bytes/1024)} KB / 版本歷程 ${store.revisions} 筆 / 拖曳期間存檔次數 ${writes}`);
await b.close(); server.close(); process.exit(0);
