import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Turning Traffic application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Turning Traffic/);
  assert.match(html, /路口尖峰轉向交通量分析系統/);
  assert.doesNotMatch(html, /codex-preview|loading skeleton/i);
});

test("ships required analysis surfaces", async () => {
  const response = await render();
  const html = await response.text();
  for (const text of ["總覽儀表板", "季度批次匯入", "路口轉向圖", "多路口比較", "歷季趨勢比較", "資料品質檢查", "備份、還原與版本"]) assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /HCM|服務水準|LOS/);
});
