/*
 * ══════════════════════════════════════════════════════════════════════
 *  字形安全名單：三支必須是同一份檔案
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 起三支都有 glyph-guard（擋「微軟正黑體不一定有的符號」）。
 * 起因是使用者 2026-09-11 回報「匯出備份名字旁邊的向下箭頭已經看不到」，
 * 以及 2026-09-15 對側欄小圖示的裁示：
 *   「請讓**任何電腦都看的到**做為前題去放小圖示，不然寧願不要放小圖示」
 *
 * ⚠️ 三支各有一份副本（交付包要能解壓後獨立執行，不可以跨包引用），
 *   所以用 SHA-256 釘住「它們是同一份」。只改一支的安全名單，
 *   那一支就會紅——要放寬名單就得三支一起改、雜湊一起換。
 *   這正是我們要的：**「這個字在正黑體裡有沒有」對三支是同一個事實。**
 *
 * ⚠️ 換雜湊之前請先確認新加的字**真的在 Big5 符號區**，
 *   不要因為「自己電腦看得到」就加——那正是這一整套要防的事。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("glyph-guard 必須與另外兩支逐位元相同", () => {
  const bytes = readFileSync(new URL("../scripts/glyph-guard.mjs", import.meta.url));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "bcd78758b9eb992e1f0939fa6f4daaa80fc6d86efc92a0e969c484bfe83a484d",
    "字形安全名單與另外兩支不同步；三支必須是同一份檔案",
  );
});
