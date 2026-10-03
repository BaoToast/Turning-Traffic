import { isSameSurvey } from "./traffic.ts";

type SurveyKey = {
  projectId?: string;
  quarter?: string;
  station?: string;
  surveyType?: string;
};
type Context = { projectId: string; quarter: string };

/** 與實際寫入共用：先找完全相同的資料別，才接手待設定的舊紀錄。 */
export function findSurveyReplacement(
  records: readonly SurveyKey[],
  item: SurveyKey,
  context: Context,
): number {
  const exact = records.findIndex((record) =>
    record.projectId === context.projectId &&
    record.quarter === context.quarter &&
    record.station === item.station &&
    (record.surveyType || "待設定") === (item.surveyType || "待設定"),
  );
  return exact >= 0 ? exact : records.findIndex((record) => isSameSurvey(record, item, context));
}

/** 只規劃真的會被替換的舊紀錄；不改原陣列，不把略過列或其他候選當成覆蓋。 */
export function plannedSurveyOverwrites<T extends SurveyKey, I extends SurveyKey>(
  records: readonly T[],
  items: readonly I[],
  context: Context,
  modeOf: (item: I) => string,
): { record: T; incoming: I }[] {
  const simulated: SurveyKey[] = records.map((record) => ({ ...record }));
  const result: { record: T; incoming: I }[] = [];
  for (const incoming of items) {
    const found = findSurveyReplacement(simulated, incoming, context);
    if (found >= 0 && modeOf(incoming) === "skip") continue;
    if (found >= 0) {
      if (found < records.length) result.push({ record: records[found], incoming });
      simulated[found] = { ...incoming, ...context };
    } else {
      simulated.push({ ...incoming, ...context });
    }
  }
  return result;
}
