/*
 * ══════════════════════════════════════════════════════════════════════
 *  「選一個路口，直接從顏色看它的左轉／直行／右轉對不對」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「全日交通量的路口轉向設定，我可以直接從圖片中看出各路口轉向
 *     左/右/直是否正確，我可以逐一選擇路口，直接從圖片看轉向顏色，
 *     顏色不對的地方表示轉向錯誤，要去對應的地方調整轉向。
 *     **路口轉向則無法做到，能幫路口轉向也新增的這個功能嗎?**」
 *
 * ── 為什麼要另外畫一張，而不是改本來那張轉向圖 ──────────────────
 *
 * 本來那張（diagramLayout）畫的是**流量**：線的粗細是車流量、旁邊有數字、
 * 還要排圖卡。它要服務畫面、匯出 PNG、圖卡排版三種用途，參數有十個。
 * 把「用顏色表示轉向別」塞進去，等於在那三種用途上都多一個分支。
 *
 * 這裡要回答的是完全不同的問題：**「A→C 被判成直行，對嗎？」**
 * 需要的只有「支線在哪個方位」與「這一條被判成什麼轉向」，
 * 不需要流量、不需要圖卡。所以另外畫一張乾淨的，看的人也不會被數字干擾。
 *
 * ⚠️ 這張圖**不做任何判定**：轉向別一律讀 record.routes[].movement，
 *   也就是「檢查起點 → 終點流向」那張表裡的同一個值。
 *   圖和表一定一致——這正是使用者要的：圖上看到顏色不對，
 *   就去表上那一列改。如果這裡自己再算一次角度，兩邊就會分岔，
 *   而那會讓使用者對著一張「看起來錯、改了卻沒變」的圖束手無策。
 */
import type { TrafficRecord } from "../lib/traffic";

/* 三支程式共用同一組轉向顏色（全日交通量也是這三個）。 */
export const TURN_COLORS = {
  through: "#0F8A45",
  left: "#E8710A",
  right: "#0072B2",
} as const;

const TURN_LABELS: Record<string, string> = {
  through: "直行",
  left: "左轉",
  right: "右轉",
};

const SIZE = 460;
const CENTER = SIZE / 2;
const ARM = 150;

function pointAt(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(radians) * radius,
    y: CENTER + Math.sin(radians) * radius,
  };
}

export function TurnPreview(props: {
  record: TrafficRecord;
  /** 目前選的起點支線 id；空字串＝還沒選。 */
  fromId: string;
  onPickFrom: (id: string) => void;
}) {
  const { record, fromId, onPickFrom } = props;
  const approaches = record.approaches ?? [];
  const routes = record.routes ?? [];
  const from = approaches.find((item) => item.id === fromId) ?? approaches[0];

  const outgoing = from
    ? routes.filter((route) => route.fromApproachId === from.id)
    : [];

  return (
    <div className="turn-preview">
      <label className="turn-preview-pick">
        預覽起點
        <select
          value={from?.id ?? ""}
          onChange={function (event) {
            onPickFrom(event.target.value);
          }}
        >
          {approaches.map(function (item) {
            return (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            );
          })}
        </select>
      </label>

      <svg
        className="turn-preview-svg"
        viewBox={`-30 -30 ${SIZE + 60} ${SIZE + 60}`}
        role="img"
        aria-label={
          from
            ? `由${from.name}駛出的轉向判定示意圖`
            : "轉向判定示意圖"
        }
      >
        <defs>
          {(["through", "left", "right"] as const).map(function (key) {
            return (
              <marker
                key={key}
                id={`turn-arrow-${key}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={TURN_COLORS[key]} />
              </marker>
            );
          })}
        </defs>

        {/* 支線：先畫路，再畫代碼圓圈與名稱。 */}
        {approaches.map(function (item) {
          const end = pointAt(item.angle, ARM);
          const mark = pointAt(item.angle, ARM);
          const label = pointAt(item.angle, ARM + 34);
          const isFrom = from && item.id === from.id;
          return (
            <g key={item.id}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={end.x}
                y2={end.y}
                className={isFrom ? "turn-arm is-from" : "turn-arm"}
              />
              <circle cx={mark.x} cy={mark.y} r="17" className="turn-arm-mark" />
              <text x={mark.x} y={mark.y + 5} className="turn-arm-code">
                {item.name.replace(/^路口\s*/, "").slice(0, 3)}
              </text>
              <text
                x={label.x}
                y={label.y + 4}
                className="turn-arm-name"
                textAnchor={
                  Math.cos((item.angle * Math.PI) / 180) > 0.25
                    ? "start"
                    : Math.cos((item.angle * Math.PI) / 180) < -0.25
                      ? "end"
                      : "middle"
                }
              >
                {item.name}
              </text>
            </g>
          );
        })}

        {/* 由所選起點出發的每一條流向，顏色 ＝ 表上的轉向別。 */}
        {from &&
          outgoing.map(function (route) {
            const target = approaches.find(
              (item) => item.id === route.toApproachId,
            );
            if (!target) return null;
            const start = pointAt(from.angle, ARM - 22);
            const end = pointAt(target.angle, ARM - 22);
            const color =
              TURN_COLORS[route.movement as keyof typeof TURN_COLORS] ??
              "#7a8a8e";
            return (
              <path
                key={route.id}
                d={`M ${start.x} ${start.y} Q ${CENTER} ${CENTER} ${end.x} ${end.y}`}
                fill="none"
                stroke={color}
                strokeWidth="3.5"
                opacity="0.9"
                markerEnd={`url(#turn-arrow-${route.movement})`}
              />
            );
          })}

        {/*
          * ⚠️ 這行字放**左上角**，不放中央（使用者 2026-09-14）：
          *   「中間圓形處的『由X駛出』文字也可以移動到畫面左上或上方，
          *     這樣才不會有超出去圓形圖案的感覺」
          *   路口名稱長度是使用者自己命名的，中央放不下就一定會撐出去，
          *   而且會壓在車流線上。左上角本來就是空白。
          */}
        <text x={-20} y={-6} textAnchor="start" className="turn-center">
          {from ? `由${from.name}駛出` : "路口"}
        </text>

        {/*
          * 圖例放右下角。
          * ⚠️ 不可以塞進中央圓圈——全日交通量就是那樣做的，
          *   字一長就超出圓圈、還壓在車流線上，2026-09-14 已被使用者指出來。
          */}
        <g className="turn-legend">
          {(["through", "left", "right"] as const).map(function (key, index) {
            const y = SIZE - 56 + index * 20;
            return (
              <g key={key}>
                <line
                  x1={SIZE - 96}
                  y1={y}
                  x2={SIZE - 72}
                  y2={y}
                  stroke={TURN_COLORS[key]}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <text x={SIZE - 64} y={y + 4} className="turn-legend-text">
                  {TURN_LABELS[key]}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <p className="turn-preview-note">
        顏色就是「檢查起點 → 終點流向」那張表上的轉向別。
        <b>看到顏色不對，就到下面那張表把該列的轉向分類改掉</b>
        ——改完這張圖會立刻跟著變。
      </p>
      {from && outgoing.length === 0 && (
        <p className="turn-preview-empty">
          這個起點目前沒有任何流向資料，所以畫不出箭頭。
        </p>
      )}
    </div>
  );
}
