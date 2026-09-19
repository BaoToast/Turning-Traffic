/*
 * 支線名稱的小判斷。
 *
 * ⚠️ 刻意放在獨立檔案，不放在 traffic-app.tsx 裡：
 *   測試要能直接 import 它逐項驗，而 .tsx（含 JSX）在測試環境裡載不進來。
 *   純邏輯就該待在純邏輯的檔案裡。
 */

/**
 * 這一支支線有沒有「使用者自己取的名字」。
 *
 * 沒有自訂名稱時，名稱是系統用代碼組出來的（「路口A」「A」），
 * 那種情況下把代碼與名稱並排寫會變成同一件事講兩次——
 * 使用者 2026-09-14 看到的「駛出路口 A ・ 路口A」就是這樣來的。
 *
 * 判斷方式：把名稱裡的「路口」與空白去掉，看剩下的是不是就等於代碼。
 */
export function isNamedArm(code?: string, name?: string) {
  if (!name) return false;
  if (!code) return true;
  const bare = String(name).replace(/[\s路口]/g, "");
  return bare !== String(code).replace(/\s/g, "");
}
