/*
 * ══════════════════════════════════════════════════════════════════════
 *  分頁的捲動位置：第一次進去從最上面，回頭再進去接著上次看
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「我在各路口尖峰匯整滑動畫面查看到最底下後，繼續點流量核對工作台，
 *     右側的畫面不是從最上方開始讓我查看，而是從中間開始，以至於我沒發現
 *     上方還有資料。……請確認三個程式都要能，在我第一次點入 A 分頁時，
 *     該分頁的資訊都是從最上面開始展示；……然後我又跳回 A 分頁時，
 *     這不是我第一次來 A 分頁了，所以畫面要停在我上一次中斷的地方。
 *     這項功能請三個程式都要統一。」
 *
 * ── 成因 ─────────────────────────────────────────────────────────
 *   換分頁只換掉右側的內容，**視窗的捲動位置沒有人動它**。
 *   前一頁捲到 2400px，新的一頁如果也有 2400px 那麼長，就會從 2400px
 *   的地方開始顯示——畫面上看起來很正常（有標題、有表格），
 *   使用者不會意識到上面還有一大段沒看到。這比「跳到奇怪的地方」更危險。
 *
 * ── 作法 ─────────────────────────────────────────────────────────
 *   每一個分頁各記各的捲動位置：
 *     ・沒有記錄（第一次來）→ 捲到最上面
 *     ・有記錄（回頭）      → 捲回上次中斷的地方
 *
 * ⚠️ 記錄是**一邊捲一邊記**，不是「離開分頁時才記」。
 *   離開時才記會踩到一個坑：換頁之後文件高度立刻改變，
 *   瀏覽器會把超出新高度的捲動位置夾回去，這時候才去讀 scrollY
 *   讀到的是被夾過的值——使用者明明停在 2400px，記下來的卻是 800px。
 *
 * ⚠️ 還原要在 useLayoutEffect（畫面 commit 之後、瀏覽器繪製之前），
 *   不可以用 useEffect。useEffect 會讓使用者先看到「錯的位置」一幀
 *   再跳過去，那一下閃動看起來就像 bug。
 *
 * ⚠️ 記憶只活在這一次開著的分頁裡（不寫 localStorage）。
 *   重新整理之後每一頁都算「第一次進來」，從最上面開始——
 *   重整通常正是「我想重來一次」的意思。
 */
import { useEffect, useLayoutEffect, useRef } from "react";

/** 讀目前的捲動位置；舊瀏覽器沒有 scrollY 時退回 pageYOffset。 */
function currentScroll() {
  if (typeof window === "undefined") return 0;
  return window.scrollY ?? window.pageYOffset ?? 0;
}

/**
 * @param view 目前在哪一個分頁。字串換了就代表換頁。
 */
export function useViewScrollMemory(view: string) {
  /* 每一個分頁上次停在哪裡；沒有這個鍵＝還沒來過。 */
  const memory = useRef<Record<string, number>>({});
  /* 現在正在記哪一個分頁的位置。 */
  const active = useRef(view);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      memory.current[active.current] = currentScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    active.current = view;
    const saved = memory.current[view];
    /*
     * ⚠️ 不可以寫成 `saved || 0` —— 0 是**合法的記錄**（使用者就停在最上面），
     *   用 || 會把它當成「沒來過」，行為剛好一樣所以看不出來，
     *   但下一個人照抄這個寫法到別的地方就會出事。用 == null 判斷。
     */
    window.scrollTo({ top: saved == null ? 0 : saved, behavior: "auto" });
  }, [view]);
}
