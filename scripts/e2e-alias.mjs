/**
 * 路口名稱別名：兩條建立路徑都要真的生效。
 *
 *  路徑 A：在「路口名稱管理」改名 → 下一季用**舊名**的檔案自動併入
 *  路徑 B：在匯入預覽手動選「併入某路口」 → 下一季用**同一個名字**的檔案自動併入
 *
 * ⚠️ 判準是**畫面上「名稱處理」那一欄印什麼**：
 *    「自動併入」＝別名生效；出現下拉選單＝又在問使用者，就是壞的。
 *    只驗「有沒有那個路口」會恆真（併入與新建都會有路口），抓不到這個 bug。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { readdirSync } from "node:fs";
import { launchOptions } from "./chrome-path.mjs";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * ⚠️ v2.1.64 起：一批完全乾淨的匯入，逐檔明細**預設是收合的**
 *   （使用者要求：沒有異常就收合成一行提醒）。收合中的 <details>
 *   其內容仍在 DOM 裡，但 innerText 會回空字串——測試如果直接讀，
 *   會得到「找不到」而看起來像功能壞了。
 *   要讀明細就先展開，這也正是使用者會做的動作。
 */
async function openPreviewDetails(page) {
  await page.evaluate(() => {
    document
      .querySelectorAll("details.preview-details")
      .forEach((node) => {
        node.open = true;
      });
  });
  await page.waitForTimeout(250);
}

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages-dist");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png"};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p==="/")p="/index.html";const f=join(ROOT,p);if(!existsSync(f)||statSync(f).isDirectory())return void res.writeHead(404).end();res.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"});res.end(readFileSync(f));});
await new Promise(r=>server.listen(0,r));
const port=server.address().port;

const problems=[];
const ok=(l,c,d="")=>{console.log(`${c?"✅":"❌"} ${l}${d?` — ${d}`:""}`);if(!c)problems.push(l);};

/*
 * ⚠️ 用**真實調查檔**，不要自己造 Excel。
 * 第一版我自己組了一份四叉表，結果被判成「無法辨識」而完全沒有預覽列——
 * 於是每一項斷言都對著空畫面驗，紅得莫名其妙。
 * 匯入的版型判定很細，只有真檔才走得完整條路徑。
 * （真實檔只留在測試環境，不進任何交付包。）
 */
/*
 * ⚠️ 真實調查檔只在測試環境，**不進任何交付包**。
 * 找不到的時候整支跳過（並印出原因），不可以讓它變成紅字——
 * 別台電腦解壓交付包來跑時本來就沒有這些檔。
 */
const REAL = join(here, "..", "..", "realdata", "batch1");
if (!existsSync(REAL)) {
  console.log("⏭  找不到真實調查檔資料夾，略過別名檢查（交付包裡沒有這些檔是正常的）");
  server.close();
  process.exit(0);
}
const REALFILE = join(
  REAL,
  readdirSync(REAL).filter((f) => /\.xlsx$/i.test(f) && !/^~\$/.test(f))[0],
);
const REALBUF = readFileSync(REALFILE);

const b=await chromium.launch(launchOptions());
const page=await (await b.newContext({viewport:{width:1600,height:1100},locale:"zh-TW"})).newPage();
page.on("dialog",d=>d.accept(""));
await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(1600);

async function importOne(fileName, buffer, year, q) {
  await page.locator('aside.sidebar nav button:has-text("季度批次匯入")').first().click();
  await page.waitForTimeout(700);
  await page.locator('.content label:has-text("調查年度") input').first().fill(year);
  await page.locator('.content label:has-text("季度") select').first().selectOption(q);
  await page.waitForTimeout(300);
  await page.evaluate(({name,base64})=>{
    const zone=document.querySelector(".upload-card");const t=new DataTransfer();
    const bin=atob(base64);const by=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)by[i]=bin.charCodeAt(i);
    t.items.add(new File([by],name,{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    zone.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:t}));
  },{name:fileName,base64:buffer.toString("base64")});
  await page.waitForTimeout(6000);
}
/**
 * 預覽裡「名稱處理」那一欄目前印什麼。
 *
 * ⚠️ 欄位序號一定要**從表頭找**，不可以寫死。
 * 第一版寫死 children[4]，抓到的其實是車種歸類面板的下拉
 *（選項是「併入：機車」），完全不是名稱處理欄——
 * 斷言於是驗了一個無關的元素。
 */
const nameCell = async () => {
  await openPreviewDetails(page);
  return page.evaluate(() => {
  const table=[...document.querySelectorAll(".content table")]
    .find(t=>[...t.querySelectorAll("thead th")].some(th=>th.textContent.includes("名稱處理")));
  if(!table) return "(找不到匯入預覽表)";
  const idx=[...table.querySelectorAll("thead th")].findIndex(th=>th.textContent.includes("名稱處理"));
  const tr=table.querySelector("tbody tr");
  if(!tr) return "(沒有預覽列)";
  const td=tr.children[idx];
  if(!td) return "(找不到名稱處理欄)";
  return td.querySelector("select") ? "下拉選單（又在問）" : td.innerText.replace(/\s+/g," ").trim();
  });
};
const commit = async () => {
  await page.locator('button:has-text("確認寫入"), button:has-text("寫入")').first().click();
  await page.waitForTimeout(4000);
  for (const label of ["全部先保留（不記住）","關閉","取消"]) {
    const btn = page.locator(`.modal-backdrop button:has-text("${label}")`);
    if (await btn.count()) { await btn.first().click().catch(()=>{}); await page.waitForTimeout(800); }
  }
};

/* 建計畫 */
await page.locator('aside.sidebar nav button:has-text("建立與管理計畫")').first().click();
await page.waitForTimeout(600);
await page.locator(".project-form input").nth(0).fill("115-ALIAS");
await page.locator(".project-form input").nth(1).fill("別名測試計畫");
await page.locator('button:has-text("建立計畫")').click(); await page.waitForTimeout(1000);

/* ── 路徑 A：改名之後，用舊名的檔案要自動併入 ── */
await importOne(REALFILE.split("/").pop(), REALBUF, "115", "1");
ok("前置：第一季匯得進來", (await nameCell()).length > 0, await nameCell());
await commit();

await page.locator('aside.sidebar nav button:has-text("路口名稱管理")').first().click();
await page.waitForTimeout(900);
const nameInput = page.locator('.content table input').first();
const beforeName = await nameInput.inputValue();
await nameInput.fill("甲路與乙路交叉口（正式名）");
/* 用「點別的地方」離開欄位，跟使用者的動作一致 */
await page.locator(".content h1, .page-head h1").first().click().catch(()=>{});
await nameInput.blur().catch(()=>{});
await page.waitForTimeout(2000);
/* 診斷：別名到底有沒有被寫進儲存的狀態 */
const diag = await page.evaluate(async () => {
  const toast = document.querySelector(".toast")?.textContent?.trim().slice(0, 60) || "(沒有 toast)";
  const inputs = [...document.querySelectorAll(".content table input")].map((i) => i.value).slice(0, 4);
  let aliases = "(讀不到)";
  try {
    const dbs = await indexedDB.databases();
    for (const info of dbs) {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); r.onerror = rej;
      });
      for (const store of [...db.objectStoreNames]) {
        const all = await new Promise((res) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => res(r.result); r.onerror = () => res([]);
        });
        for (const row of all) {
          const text = typeof row === "string" ? row : JSON.stringify(row);
          if (text.includes("intersectionAliases")) {
            const m = /"intersectionAliases":(\{[^}]*\})/.exec(text);
            aliases = m ? m[1] : "(有欄位但取不到)";
          }
        }
      }
    }
  } catch (e) { aliases = "(例外) " + e.message; }
  return { toast, inputs, aliases };
});
console.log("── 改名前的值：", beforeName);
console.log("── 改名後診斷：", JSON.stringify(diag));

await importOne(REALFILE.split("/").pop(), REALBUF, "115", "2");
const afterRename = await nameCell();
ok("路徑 A：改名之後，用舊名的檔案要「自動併入」", /自動併入/.test(afterRename), afterRename);
await commit();

/* ── 路徑 B：手動選併入之後，同一個名字要自動併入 ── */
await importOne("11017T9-01_完全不同的路口名稱測試.xlsx", REALBUF, "115", "3");
const beforeManual = await nameCell();
console.log("── 第三季（新名字）名稱處理欄：", beforeManual);
const pickerHandle = await page.evaluateHandle(() => {
  const table=[...document.querySelectorAll(".content table")]
    .find(t=>[...t.querySelectorAll("thead th")].some(th=>th.textContent.includes("名稱處理")));
  const idx=[...table.querySelectorAll("thead th")].findIndex(th=>th.textContent.includes("名稱處理"));
  return table.querySelector("tbody tr").children[idx].querySelector("select");
});
const picker = pickerHandle.asElement();
if (picker) {
  const opts = await picker.evaluate((el)=>[...el.options].map(o=>o.textContent.trim()));
  const merge = opts.find((t) => t.startsWith("併入："));
  ok("前置：新名字時要出現「併入」選項（沒有的話下一項無從驗起）", Boolean(merge), opts.join("｜"));
  if (merge) { await picker.evaluate((el,label)=>{const o=[...el.options].find(x=>x.textContent.trim()===label);el.value=o.value;el.dispatchEvent(new Event("change",{bubbles:true}));},merge); await page.waitForTimeout(600); }
}
await commit();

await importOne("11017T9-01_完全不同的路口名稱測試.xlsx", REALBUF, "115", "4");
const afterManual = await nameCell();
ok("路徑 B：手動選過併入之後，同一個名字要「自動併入」", /自動併入/.test(afterManual), afterManual);


await b.close(); server.close();
console.log(problems.length?`\n❌ 共 ${problems.length} 項`:"\n✅ 全部通過");
process.exit(problems.length?1:0);
