from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "Turning-Traffic-v2.0.1-新手操作手冊.pdf"
PUBLIC = ROOT / "public" / OUTPUT.name

TEAL = colors.HexColor("#087F75")
INK = colors.HexColor("#17353E")
MUTED = colors.HexColor("#61777D")
PALE = colors.HexColor("#EAF4F1")
CREAM = colors.HexColor("#FBF8F0")
AMBER = colors.HexColor("#D88A23")
LINE = colors.HexColor("#DCE6E3")


def register_fonts():
    pdfmetrics.registerFont(TTFont("Guide", r"C:\Windows\Fonts\msjh.ttc", subfontIndex=0))
    pdfmetrics.registerFont(TTFont("GuideBold", r"C:\Windows\Fonts\msjhbd.ttc", subfontIndex=0))


def p(text, style):
    return Paragraph(text, style)


def build_styles():
    styles = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle("cover_title", fontName="GuideBold", fontSize=27, leading=37, textColor=INK, alignment=TA_CENTER, spaceAfter=10),
        "cover_sub": ParagraphStyle("cover_sub", fontName="Guide", fontSize=12, leading=20, textColor=MUTED, alignment=TA_CENTER),
        "h1": ParagraphStyle("h1", fontName="GuideBold", fontSize=20, leading=27, textColor=INK, spaceBefore=3, spaceAfter=12),
        "h2": ParagraphStyle("h2", fontName="GuideBold", fontSize=13, leading=19, textColor=TEAL, spaceBefore=10, spaceAfter=7),
        "body": ParagraphStyle("body", fontName="Guide", fontSize=9.5, leading=16, textColor=INK, spaceAfter=7),
        "small": ParagraphStyle("small", fontName="Guide", fontSize=8, leading=13, textColor=MUTED),
        "callout": ParagraphStyle("callout", fontName="Guide", fontSize=9, leading=15, textColor=INK, leftIndent=4, rightIndent=4),
        "table": ParagraphStyle("table", fontName="Guide", fontSize=8, leading=12, textColor=INK),
        "table_head": ParagraphStyle("table_head", fontName="GuideBold", fontSize=8, leading=12, textColor=colors.white, alignment=TA_CENTER),
        "step": ParagraphStyle("step", fontName="GuideBold", fontSize=12, leading=17, textColor=INK),
    }


def header_footer(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setStrokeColor(LINE)
        canvas.line(18 * mm, 282 * mm, 192 * mm, 282 * mm)
        canvas.setFont("Guide", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 286 * mm, "Turning Traffic 路口尖峰轉向交通量分析系統")
        canvas.drawRightString(192 * mm, 12 * mm, f"v2.0.1  |  第 {page} 頁")
    canvas.restoreState()


def callout(text, styles, color=PALE):
    table = Table([[p(text, styles["callout"])]], colWidths=[166 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("BOX", (0, 0), (-1, -1), 0.6, TEAL if color == PALE else AMBER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def info_table(rows, widths, styles, header=True):
    cooked = []
    for row_index, row in enumerate(rows):
        style = styles["table_head"] if header and row_index == 0 else styles["table"]
        cooked.append([p(str(cell), style) for cell in row])
    table = Table(cooked, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    if header:
        commands.append(("BACKGROUND", (0, 0), (-1, 0), TEAL))
    for index in range(1 if header else 0, len(rows)):
        if index % 2 == 0:
            commands.append(("BACKGROUND", (0, index), (-1, index), colors.HexColor("#F6F9F8")))
    table.setStyle(TableStyle(commands))
    return table


def step(number, title, text, styles):
    badge = Table([[p(str(number), ParagraphStyle("badge", fontName="GuideBold", fontSize=16, textColor=colors.white, alignment=TA_CENTER))]], colWidths=[12 * mm], rowHeights=[12 * mm])
    badge.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TEAL), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    body = [p(title, styles["step"]), p(text, styles["body"])]
    return KeepTogether(Table([[badge, body]], colWidths=[17 * mm, 149 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)])))


def build_manual():
    register_fonts()
    styles = build_styles()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    frame = Frame(18 * mm, 18 * mm, 174 * mm, 262 * mm, id="normal")
    doc = BaseDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm, title="Turning Traffic v2.0.1 新手操作手冊", author="Turning Traffic")
    doc.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=header_footer)])
    story = []

    story += [Spacer(1, 35 * mm), p("Turning Traffic", styles["cover_title"]), p("路口尖峰轉向交通量分析系統", styles["cover_title"]), Spacer(1, 5 * mm), p("新手操作手冊", ParagraphStyle("guide", parent=styles["cover_title"], fontSize=22, textColor=TEAL)), Spacer(1, 8 * mm), p("寫給第一次接觸交通調查與第一次使用本系統的人", styles["cover_sub"]), Spacer(1, 25 * mm)]
    cover_box = Table([[p("這本手冊會帶您完成：建立計畫 - 匯入 Excel - 檢查資料 - 調整道路 - 產生轉向圖 - 匯出成果 - 跨電腦備份", styles["callout"])]], colWidths=[150 * mm])
    cover_box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), 0.8, TEAL), ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 12)]))
    story += [cover_box, Spacer(1, 28 * mm), p("版本 v2.0.1  |  2026-08-21", styles["cover_sub"]), PageBreak()]

    story += [p("先知道：這套系統能做什麼", styles["h1"]), p("Turning Traffic 用來整理路口轉向交通調查。它會從調查 Excel 中辨識每個時間區間、車種與起點到終點的車流，計算上午及下午尖峰一小時交通量，並產生路口轉向圖、車種組成、跨季趨勢及 Excel／PDF 成果。", styles["body"]), callout("重要：道路角度決定圖怎麼畫；原始支線代碼與 OD 流向決定數據怎麼加總。調整角度或圖卡位置，不會交換 A、B、C 的資料，也不會改變交通量。", styles), p("建議的新手操作順序", styles["h2"])]
    for number, title, text in [
        (1, "建立計畫", "把同一案件的不同季度放在同一計畫中；不同委託案分開建立。"),
        (2, "指定年度與季度", "匯入前先選民國年度與第幾季，避免資料存錯季度。"),
        (3, "匯入原始 Excel", "系統先預覽辨識結果，不會立刻寫入。確認檔案角色、日期、站號、平假日與尖峰後再匯入。"),
        (4, "處理資料品質問題", "先處理缺值、未對應流向、日期辨識及守恆差值，再製作正式成果。"),
        (5, "核對道路與流向", "依原始簡圖調整支線角度，確認 A、B、C 對應正確；多岔路再檢查左直右分類。"),
        (6, "產圖、分析、匯出與備份", "完成核對後輸出成果，最後下載完整備份 ZIP。"),
    ]:
        story.append(step(number, title, text, styles))
    story.append(PageBreak())

    story += [p("第一章　建立計畫與季度", styles["h1"]), p("進入「多計畫管理」，輸入計畫代碼與計畫名稱。計畫代碼建議使用公司既有案號，例如 11017；名稱則使用容易辨識的正式計畫名稱。", styles["body"]), info_table([
        ["項目", "建議填法", "作用"],
        ["計畫代碼", "11017", "簡短、固定且不重複"],
        ["計畫名稱", "高雄岡山路竹延伸線交通監測", "報表與比較畫面顯示"],
        ["委託單位", "依契約填寫，可留空", "成果識別用，不參與計算"],
        ["備註", "調查範圍或資料來源", "協助日後辨識"],
    ], [30 * mm, 58 * mm, 78 * mm], styles), Spacer(1, 4 * mm), callout("測試用計畫可以刪除。刪除前若已匯入資料，建議先下載完整備份。", styles, CREAM), p("季度的意思", styles["h2"]), p("例如 115Q2 代表民國 115 年第 2 季。匯入頁會要求先選年度與季度；系統不應只靠檔名猜季度。相同路口的不同季度資料會保留為不同成果，但共用標準路口名稱與幾何設定。", styles["body"]), PageBreak()]

    story += [p("第二章　匯入 Excel", styles["h1"]), p("進入「季度批次匯入」，先選計畫、年度、季度，再拖入或選取一份或多份 Excel。系統會先顯示匯入預覽。", styles["body"]), p("匯入預覽要看什麼", styles["h2"]), info_table([
        ["欄位", "您要確認的內容"],
        ["角色", "應顯示原始交通量；照片會忽略，非路口轉向資料不會硬建轉向圖。"],
        ["站號／路口", "站號與正式道路名稱是否合理。"],
        ["調查日期", "日期是否由正確工作表與儲存格讀到。"],
        ["AM／PM Peak", "尖峰時段與 PCU/hr 是否有值。"],
        ["車種", "系統辨識到幾種車種，以及每種車種是否獨立保留或併入標準類別。"],
        ["版本／差異", "相同季度重複匯入時，選保留新版、覆蓋或略過。"],
    ], [39 * mm, 127 * mm], styles), p("車種不只四種時", styles["h2"]), p("系統會依欄名辨識任意數量車種。大貨車、大客車、聯結車等可各自保留，也可由使用者併入大型車或特種車。每個保留車種都會出現在車種分析與轉向當量設定。", styles["body"]), callout("不要為了讓畫面沒有警示而隨意合併車種或流向。無法確定時保留原分類或未對應數量，再回原始檔核對。", styles, CREAM), PageBreak()]

    story += [p("第三章　資料品質檢查", styles["h1"]), p("匯入完成後先進入「資料品質檢查」。這一頁的目的不是判定現場流量高低是否合理，而是找出資料是否缺漏、加總是否守恆，或系統是否未能辨識欄位。", styles["body"]), info_table([
        ["檢查項目", "代表意思", "建議處理"],
        ["缺值", "必要日期、時段或數字沒有讀到", "查看原因中的工作表與儲存格；必要時重新匯入"],
        ["總數不一致", "原始車種合計與轉向加總不同", "展開核對工作台，找出漏算或重複欄位"],
        ["未對應流向", "數量存在，但起點或終點無法確定", "保留數量並確認 OD，不可直接刪除"],
        ["尖峰時段異常", "最高連續一小時落在設定範圍外", "確認調查時段與 AM／PM 定義"],
        ["守恆差值", "OD 駛出總量與駛入總量不一致", "通常表示流向未完整對應，應逐筆追查"],
    ], [33 * mm, 57 * mm, 76 * mm], styles), callout("實際某一方向車很多，不是資料錯誤。系統不再用單純『高於平均幾倍』警告實際調查流量。", styles), PageBreak()]

    story += [p("第四章　道路、支線與流向", styles["h1"]), p("「道路與流向管理」負責圖面幾何及 OD 對應。支線 A、B、C 是原始資料識別碼；道路名稱和角度可調整，但原始代碼不會因畫面位置改變。", styles["body"]), p("角度怎麼看", styles["h2"]), info_table([
        ["角度", "畫面位置", "自動方位"],
        ["-90° 或 270°", "上方", "北"],
        ["0°", "右方", "東"],
        ["90°", "下方", "南"],
        ["180°", "左方", "西"],
    ], [45 * mm, 60 * mm, 60 * mm], styles), p("右側道路簡圖", styles["h2"]), p("右側固定顯示清楚的道路簡圖，適合核對支線角度與 A、B、C 位置。這個簡圖不顯示交通量數據框。", styles["body"]), p("交通量圖卡排版預覽", styles["h2"]), p("需要調整正式轉向圖數據框時，按「開啟圖卡排版預覽」。下方會出現全幅正式圖，可切換只看駛入、只看駛出或同時顯示，並直接拖曳數據框。", styles["body"]), info_table([
        ["控制", "效果", "是否影響計算"],
        ["左右 X", "正值向右、負值向左", "否"],
        ["上下 Y", "正值向下、負值向上", "否"],
        ["重設所有圖卡位置", "回到系統自動排版", "否"],
        ["支線角度", "改變道路在圖上的方向", "不改原始 OD 數量"],
    ], [40 * mm, 68 * mm, 58 * mm], styles), PageBreak()]

    story += [p("第五章　轉向圖與流量數字", styles["h1"]), p("「路口轉向圖」可選季度、路口、AM／PM Peak、版型、箭線、顯示內容及車種。正式成果建議使用正式版。", styles["body"]), info_table([
        ["選項", "用途"],
        ["只顯示駛出", "數據框與箭線都以從該支線出發、駛向中央路口的車流為主。"],
        ["只顯示駛入", "數據框與箭線都以穿越中央路口後、進入該支線的車流為主。"],
        ["駛入＋駛出", "每條支線分成兩個框，完整呈現雙向 OD 流向。"],
        ["全部車種", "數值為乘上各車種左直右當量後的 PCU/hr。"],
        ["單一車種", "數值改用實際車輛數，單位為輛/hr。"],
        ["交通量＋百分比", "同時顯示數值與該方向內左直右所占比例。"],
    ], [43 * mm, 123 * mm], styles), callout("『駛出路口 A』是從 A 支線出發；『駛入路口 A』是車流最後進入 A 支線。不要把兩者相加當作不重複的總車輛數，同一輛車會在起點與終點各出現一次。", styles, CREAM), PageBreak()]

    story += [p("第六章　常用分析頁面", styles["h1"]), info_table([
        ["頁面", "您會看到什麼", "何時使用"],
        ["總覽儀表板", "本季路口數、最高流量、AM／PM 排名及季增減", "快速掌握整季成果"],
        ["車種組成分析", "各車種輛/hr、比例及全調查時段車種數", "製作車種組成表"],
        ["各路口駛入／駛出流量", "全日、AM Peak、PM Peak 的 PCU 與實際車輛數", "查看每條支線的進出量"],
        ["跨計畫／多路口比較", "不同計畫與路口的尖峰及各支線流量", "多案件並列比較"],
        ["歷季趨勢比較", "同一路口從起始季到結束季的 AM／PM 變化", "長期趨勢與季增減"],
        ["流量核對工作台", "每筆總量的工作表、儲存格、時間、OD、車種、當量", "數字與人工計算不一致時"],
        ["轉向進階分析", "OD 矩陣、支線平衡、連續 60 分鐘候選尖峰", "複核流向與尖峰選取"],
    ], [36 * mm, 78 * mm, 52 * mm], styles), p("V/C 與服務水準", styles["h2"]), p("本系統的核心是尖峰轉向交通量彙整。現有原始調查通常沒有完整號誌、有效綠燈、飽和流率與車道使用資料，因此不計算 HCM／LOS，也不以經驗值假裝成正式服務水準。", styles["body"]), PageBreak()]

    story += [p("第七章　車種轉向當量", styles["h1"]), p("PCU 是將不同車種換算成小客車當量後加總。每一車種可分別設定左轉、直行、右轉當量。系統會保存匯入當時的車種分類與係數快照，方便日後追溯。", styles["body"]), info_table([
        ["情況", "建議作法"],
        ["沿用既定四車種", "確認機車、小型車、大型車、特種車係數後使用。"],
        ["出現新車種", "可獨立保留並輸入左直右當量。"],
        ["新車種要併類", "例如大客車併大型車，大貨車與聯結車併特種車。"],
        ["不知道係數", "先查計畫採用規範或契約；不要隨意用 1 取代後當正式成果。"],
    ], [48 * mm, 118 * mm], styles), callout("修改當量會改變 PCU/hr，屬於計算參數變更；修改前應留下版本，成果確認後可鎖定季度。", styles, CREAM), PageBreak()]

    story += [p("第八章　成果鎖定、匯出與備份", styles["h1"]), p("建議完成日期、OD、車種、當量、道路角度與尖峰數值核對後，將季度狀態設為已確認並鎖定。鎖定後若要修改，系統會提示版本衝突並要求人工解除。", styles["body"]), p("輸出格式", styles["h2"]), info_table([
        ["格式", "適合用途"],
        ["Excel", "車種組成、歷季趨勢與跨計畫比較；數據及趨勢圖可編輯。"],
        ["PNG", "放入 Word、PowerPoint 或電子郵件。"],
        ["SVG", "無損縮放與專業排版。"],
        ["PDF", "正式列印，一頁一路口。"],
        ["批次成果 ZIP", "多計畫、多季度一次產生 Excel、PDF 與轉向圖。"],
    ], [43 * mm, 123 * mm], styles), p("跨電腦備份", styles["h2"]), p("網站資料主要保存在目前瀏覽器。完成工作後請到「備份、還原與版本」下載完整 ZIP。到另一台電腦開啟同一網站，再匯入 ZIP，即可恢復計畫、季度、名稱映射、當量、格式記憶、車種方案及版本紀錄。", styles["body"]), callout("只有匯出 Excel 或圖片，不能恢復完整系統狀態。跨電腦接續工作必須使用完整備份 ZIP 或 JSON。", styles), PageBreak()]

    story += [p("第九章　常用名詞白話表", styles["h1"]), info_table([
        ["名詞", "白話意思"],
        ["PCU/hr", "每小時小客車當量；各車種數量乘上對應當量後相加。"],
        ["AM／PM Peak", "上午／下午調查範圍內，連續一小時交通量最高的時段。"],
        ["左轉／直行／右轉", "相對於車輛從某支線駛入中央路口後的前進方向；多岔路可能需人工確認分類。"],
        ["OD", "Origin 到 Destination，也就是從哪條支線出發、最後進入哪條支線。"],
        ["駛出支線", "車輛從該支線出發，朝中央路口行駛。"],
        ["駛入支線", "車輛穿越中央路口後，最後進入該支線。"],
        ["守恆", "所有已對應 OD 的駛出總量應等於駛入總量。"],
        ["UNMAPPED／未對應", "數量存在但流向不確定；保留數量並警示。"],
        ["圖卡位移", "只調整數據框在圖上的位置，不改交通量。"],
        ["標準路口名稱", "不同季度與檔名共同使用的正式名稱，用來正確做歷季比較。"],
    ], [47 * mm, 119 * mm], styles), PageBreak()]

    story += [p("第十章　遇到問題怎麼判斷", styles["h1"]), info_table([
        ["看到的狀況", "先檢查什麼"],
        ["調查日期顯示缺值", "查看品質檢查列出的工作表與儲存格；確認是否為民國日期、合併儲存格或不同版型。"],
        ["同一路口不同季度無法比較", "到路口名稱管理確認兩季是否併到同一標準路口。"],
        ["A、B、C 畫在錯誤方向", "調整支線角度；不要用改名稱或交換代碼修圖。"],
        ["人工計算與系統不同", "到流量核對工作台展開工作表、儲存格、OD、車種、係數與 PCU。"],
        ["多岔路圖卡重疊", "開啟圖卡排版預覽，拖曳圖卡或輸入左右 X／上下 Y。"],
        ["換電腦後資料不見", "在原電腦下載完整備份 ZIP，再於新電腦匯入。"],
        ["網站看起來仍是舊版", "重新整理或使用無痕視窗，並確認左下角版本號。"],
    ], [52 * mm, 114 * mm], styles), Spacer(1, 6 * mm), callout("正式成果原則：先看來源、再看計算、最後才看圖面。圖畫得漂亮不能證明數值正確；數值可追溯、流向守恆、版本可還原，才是可靠成果。", styles), Spacer(1, 18 * mm), p("手冊結束", ParagraphStyle("end", parent=styles["h1"], alignment=TA_CENTER, textColor=TEAL)), p("建議第一次操作時，一邊開著網站的「新手操作手冊」頁面，一邊依六個步驟完成一份測試資料。", styles["cover_sub"])]

    doc.build(story)
    PUBLIC.write_bytes(OUTPUT.read_bytes())
    print(OUTPUT)


if __name__ == "__main__":
    build_manual()
