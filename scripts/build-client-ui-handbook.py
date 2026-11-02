"""Build the bilingual handbook. Requires reportlab; run from any directory.

python scripts/build-client-ui-handbook.py [output/pdf/handbook.pdf]
Reviewed against the editor source on 2026-11-02. No remote assets required.
"""
from pathlib import Path
from xml.sax.saxutils import escape
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, Preformatted

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "output/pdf/handbook.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont("CN", "C:/Windows/Fonts/simhei.ttf"))
pdfmetrics.registerFont(TTFont("Latin", "C:/Windows/Fonts/segoeui.ttf"))
pdfmetrics.registerFont(TTFont("LatinBold", "C:/Windows/Fonts/segoeuib.ttf"))
pdfmetrics.registerFont(TTFont("Mono", "C:/Windows/Fonts/consola.ttf"))
W, H = A4
M = 43
CW = W - M * 2
INK = colors.HexColor("#202E43")
MUTED = colors.HexColor("#546477")
BLUE = colors.HexColor("#3169CA")
CYAN = colors.HexColor("#23BED0")
PALE = colors.HexColor("#EDF4FC")
LINE = colors.HexColor("#D7E1ED")
VIDEO = "https://www.bilibili.com/video/BV1Qpau6cEUS/"
HANDBOOK = "https://oss.xiaomol444.xyz/ugc-tool-data/ClientUIAnimationEditor/handbook/handbook.pdf?v=20261102.1"
STYLES = {
    "zh": ParagraphStyle("zh", fontName="CN", fontSize=10, leading=15, textColor=INK, spaceAfter=3, wordWrap="CJK"),
    "en": ParagraphStyle("en", fontName="Latin", fontSize=9, leading=13.2, textColor=MUTED, spaceAfter=10),
    "h": ParagraphStyle("h", fontName="CN", fontSize=12, leading=17, textColor=BLUE, spaceBefore=9, spaceAfter=5),
    "small": ParagraphStyle("small", fontName="Latin", fontSize=8, leading=11.5, textColor=MUTED),
    "cellzh": ParagraphStyle("cellzh", fontName="CN", fontSize=9, leading=13, textColor=INK, wordWrap="CJK"),
    "cellen": ParagraphStyle("cellen", fontName="Latin", fontSize=8.2, leading=11.5, textColor=MUTED),
    "code": ParagraphStyle("code", fontName="Mono", fontSize=8.1, leading=11.7, textColor=INK),
}


def para(text, style="zh"):
    return Paragraph(escape(text).replace("\n", "<br/>"), STYLES[style])


def pair(zh, en):
    return [para(zh), para(en, "en")]


def heading(zh, en):
    return para(f"{zh} / {en}", "h")


def cell(zh, en):
    return [para(zh, "cellzh"), para(en, "cellen")]


def table(rows, widths):
    t = Table([[cell(*v) for v in row] for row in rows], colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("LINEBELOW", (0, 0), (-1, 0), 1, LINE),
        ("LINEBELOW", (0, 1), (-1, -1), .45, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
c.setTitle("客户端 UI 动画编辑器使用指南 | Client UI Animation Editor Handbook")
c.setAuthor("晓末L444 / XiaomoL444")
c.setSubject("Chinese and English instructions; editor workflow, keyframes, assets and Lua integration")
c.setKeywords("ClientUIAnimationEditor, handbook, Chinese, English, TweenTimelineLib")
PAGE = 0
AUDIT = []


def footer():
    c.setStrokeColor(LINE)
    c.line(M, 43, W - M, 43)
    c.setFont("Latin", 8)
    c.setFillColor(MUTED)
    c.drawString(M, 28, "XIAOMOL444  /  CLIENT UI ANIMATION EDITOR")
    c.drawRightString(W - M, 28, f"2026.11.02   |   {PAGE:02d} / 14")


def start(zh, en, section):
    global PAGE
    PAGE += 1
    c.bookmarkPage(f"page{PAGE}")
    c.addOutlineEntry(f"{zh} / {en}", f"page{PAGE}", level=0, closed=False)
    c.setFillColor(BLUE)
    c.setFont("LatinBold", 8.5)
    c.drawString(M, H - 34, f"HANDBOOK  /  {section.upper()}")
    c.setFillColor(INK)
    c.setFont("CN", 22)
    c.drawString(M, H - 70, zh)
    c.setFont("Latin", 13)
    c.setFillColor(MUTED)
    c.drawString(M, H - 92, en)
    c.setFillColor(CYAN)
    c.rect(M, H - 107, 38, 3, fill=1, stroke=0)
    footer()


def flow(items, top=H - 124, bottom=62):
    y = top
    for item in items:
        _, height = item.wrap(CW, H)
        if y - height < bottom:
            raise RuntimeError(f"Page {PAGE}: overflow by {bottom - y + height:.1f} pt")
        item.drawOn(c, M, y - height)
        y -= height + item.getSpaceAfter() + item.getSpaceBefore()
    AUDIT.append((PAGE, round(y, 1)))
    return y


def page(zh, en, section, items):
    start(zh, en, section)
    flow(items)
    c.showPage()


# 01 / Cover
PAGE = 1
c.bookmarkPage("page1")
c.addOutlineEntry("封面 / Cover", "page1", 0)
c.setFillColor(INK)
c.rect(0, H - 380, W, 380, fill=1, stroke=0)
c.setFillColor(CYAN)
c.rect(M, H - 70, 45, 5, fill=1, stroke=0)
c.setFont("LatinBold", 10)
c.drawString(M, H - 100, "XIAOMOL444  /  CREATOR HANDBOOK")
c.setFillColor(colors.white)
c.setFont("CN", 29)
c.drawString(M, H - 161, "客户端 UI 动画编辑器")
c.drawString(M, H - 202, "使用指南手册")
c.setFont("Latin", 22)
c.drawString(M, H - 254, "Client UI Animation Editor")
c.drawString(M, H - 285, "User Handbook")
c.setFillColor(colors.HexColor("#C5D8EE"))
c.setFont("CN", 11)
c.drawString(M, H - 333, "中英双语说明  /  Chinese + English instructions")
flow([
    heading("从第一个关键帧到游戏内播放", "From first keyframe to in-game playback"),
    *pair("先做一个可预览的位移动画，再保存工程、导出布局与动画数据，最后接入游戏客户端。", "Create a visible movement first, save your editable project, export layout and animation data, then connect them to the game client."),
    heading("视频与手册配合使用", "Watch and follow along"),
    *pair("B 站视频：《千星UI动画编辑工具，更直观的编辑动画行为》。视频具有英文字幕；本手册按主题提供英文说明，可离线查阅。", "The Bilibili video includes English subtitles. This handbook includes English instructions for every topic and can be read offline."),
    Paragraph(f'<link href="{VIDEO}" color="#3169CA">Watch the video / BV1Qpau6cEUS</link>', STYLES["en"]),
    *pair("编写日期：2026 年 11 月 2 日。对应当前编辑器和 TweenTimelineLib v8.3；后续界面可能调整。", "Edition: 2 November 2026. Based on the current editor and TweenTimelineLib v8.3. Later releases may change labels or behavior."),
], top=H - 405)
footer()
c.showPage()

# 02 / Navigation
start("阅读路线与目录", "Reading paths and contents", "start here")
toc = [
    (3, "第一个位移动画", "Your first movement"),
    (4, "认识界面与工作区", "Interface and workspaces"),
    (5, "控件、坐标与画布", "Controls, coordinates and canvas"),
    (6, "关键帧与属性轨道", "Keyframes and property tracks"),
    (7, "多动画、缓动与增量", "Animations, easing and relative values"),
    (8, "图片资源、图元与 PSD", "Images, primitives and PSD"),
    (9, "骨骼、Spine 与动效", "Bones, Spine and effects"),
    (10, "时间轴事件", "Timeline events"),
    (11, "选择正确的导出方式", "Choose the right export"),
    (12, "游戏接入与数据导回", "Runtime integration and data import"),
    (13, "常用操作与快捷键", "Everyday actions and shortcuts"),
    (14, "问题排查与发布检查", "Troubleshooting and delivery checks"),
]
y = H - 128
for n, zh, en in toc:
    c.setFont("CN", 10.5)
    c.setFillColor(INK)
    c.drawString(M, y, zh)
    c.setFont("Latin", 9)
    c.setFillColor(MUTED)
    c.drawString(M + 177, y, en)
    c.setFont("LatinBold", 10)
    c.setFillColor(BLUE)
    c.drawRightString(W - M, y, f"{n:02d}")
    c.linkRect("", f"page{n}", (M, y - 6, W - M, y + 16), relative=0, thickness=0)
    c.setStrokeColor(LINE)
    c.line(M, y - 13, W - M, y - 13)
    y -= 32
flow([
    heading("第一次使用", "First visit"),
    *pair("按第 3、4、5、6 页学习基本操作；完成后阅读第 11、12 页接入游戏。点击目录条目可以跳转。", "Start with pages 3-6, then use pages 11-12 for game integration. Click a contents row to jump to that page."),
    heading("已有素材或遇到问题", "Existing assets or a blocked workflow"),
    *pair("PSD 和图片看第 8 页；Spine 看第 9 页；事件看第 10 页；常用操作与排查见第 13、14 页。", "Use page 8 for PSD and images, page 9 for Spine, page 10 for events, and pages 13-14 for shortcuts and troubleshooting."),
], top=y - 3)
c.showPage()

# 03 / Tutorial
page("第一个位移动画", "Your first movement", "quick start", [
    *pair("目标：让一段文字在 1 秒内从左向右移动，再停留 1 秒。先只做位置 X，成功后再加入缩放或颜色。", "Goal: move a text control from left to right in one second, then hold for one second. Start with X position before adding scale or color."),
    heading("1  创建文件与文字", "Create a file and a text control"),
    *pair("点击「新建文件」并命名。通过左侧「添加控件」添加文本框，命名为 Guide_Text，填写 Hello UI。保留默认根容器。", "Create and name a new file. Add a text box from Add control, name it Guide_Text and enter Hello UI. Keep the default root container."),
    heading("2  在起点添加轨道", "Add a track at the start"),
    *pair("点击「回到起点」，将序列时长设为 2 秒、帧率设为 30。点击时间轴中 Guide_Text 旁的加号，添加位置 X（anchoredPositionX）；新轨道会在当前播放头创建关键帧。", "Rewind, set duration to 2 seconds and frame rate to 30. Click the plus beside Guide_Text in the timeline and add X position (anchoredPositionX). A keyframe is created at the current playhead."),
    heading("3  设置起点与终点", "Set the two values"),
    *pair("选中 0 秒的菱形，在关键帧参数中把值设为 -200。再在该属性轨道的 1 秒（30f）处双击添加关键帧，将值设为 200。", "Select the diamond at 0 s and set its value to -200 in the keyframe inspector. Double-click the same property lane at 1 s (30f) to add another keyframe, then set its value to 200."),
    heading("4  设置缓动并播放", "Choose easing and preview"),
    *pair("选回 0 秒关键帧，将「到下一帧」设为补间，并选择 OutCubic。回到起点后点击播放或按空格；1 秒后应保持终点，直到 2 秒结束。", "Select the 0 s key again, use tween interpolation and choose OutCubic. Rewind and click Play or press Space. The control should reach its end position at 1 s and hold through 2 s."),
    heading("5  保存并备份", "Save and back up"),
    *pair("确认状态显示已自动保存，再通过「导出 > JSON 工程」下载一份可继续编辑的备份。位置数值表示锚点偏移，不是基础面板里的世界坐标。", "Confirm the autosaved status, then export a JSON project for an editable backup. These track values are anchor offsets, not the world coordinates shown in the Basic panel."),
])

# 04 / Map and storage
start("认识界面与工作区", "Interface and workspaces", "workspace")
diagram_top = H - 129
box_h = 153
boxes = [
    (0, 0, CW, 26, "工具栏 / Toolbar"),
    (0, 30, 90, 78, "控件层级\nHierarchy"),
    (94, 30, 205, 78, "场景画布\nCanvas"),
    (303, 30, 87, 78, "动画列表\nAnimations"),
    (394, 30, CW - 394, 78, "属性面板\nInspector"),
    (0, 112, CW, 41, "关键帧时间轴与事件 / Timeline and events"),
]
for x, dy, w, h, label in boxes:
    yy = diagram_top - dy - h
    c.setFillColor(PALE)
    c.setStrokeColor(LINE)
    c.roundRect(M + x, yy, w, h, 4, fill=1, stroke=1)
    p = para(label, "cellzh")
    _, ph = p.wrap(w - 12, h)
    p.drawOn(c, M + x + 7, yy + (h - ph) / 2)
flow([
    Spacer(1, 7),
    *pair("左侧管理父子关系；中间预览画面；动画列表切换当前 Animation；右侧修改控件或关键帧参数；下方时间轴控制时间。示意图与实际界面比例不同。", "The hierarchy manages parenting, the canvas previews the result, Animations selects the active animation, and the inspector edits values. The timeline controls time. Diagram proportions are schematic."),
    heading("工作区与文件", "Workspaces and files"),
    *pair("点击「工作区」创建、切换或重命名工作区和编辑文件。一个文件可以包含多个 Animation；切换文件前留意保存状态。导入 JSON、GIA、PSD 或 Spine 会按对应流程创建编辑文件。", "Use Workspace to create, switch or rename workspaces and editing files. One file can contain multiple animations. Check save status before switching. JSON, GIA, PSD and Spine imports create editing files through their respective import flows."),
    heading("保存与 JSON 的区别", "Saving versus a JSON export"),
    *pair("保存按钮和自动保存写入当前配置的存档后端。浏览器存档用于本浏览器内继续编辑；迁移设备、分享或长期备份时，另行导出 JSON 工程。", "Save and autosave write to the configured storage backend. Browser storage lets you resume in that browser. Export JSON separately when moving devices, sharing or keeping a long-term backup."),
    heading("撤销与操作记录", "Undo and operation history"),
    *pair("使用顶部撤销、重做按钮，或打开操作记录查看最近的编辑步骤。导入或切换文件后，不要把撤销当成独立备份。", "Use Undo, Redo and the history panel to inspect recent edits. History does not replace a separate backup after importing or switching files."),
], top=diagram_top - box_h - 7)
c.showPage()

# 05 / Transform
page("控件、坐标与画布", "Controls, coordinates and canvas", "layout", [
    heading("管理层级", "Manage the hierarchy"),
    *pair("添加容器、文本、图片、图元或其他控件。长按并拖动层级项可改变父级或排列顺序；边缘放置调整顺序，中间放置成为子级。根容器不能删除。", "Add containers, text, images, primitives or other controls. Hold and drag hierarchy items to reparent or reorder them: edges reorder, the middle nests. The root container cannot be deleted."),
    *pair("同级控件尽量使用唯一名称，名称中不要包含 /。Lua 动画通过相对名称路径查找控件，重名或路径改变会使导出、导回或游戏查找失败。", "Use unique sibling names without /. Lua animation resolves relative name paths. Duplicate names or a changed hierarchy can break export, reimport or runtime lookup."),
    heading("基础、运行时与锚点", "Basic, Runtime and anchors"),
    *pair("基础页的预览位置使用世界坐标，原点在左下。运行时页显示 anchoredPosition、sizeDelta 等布局原值；改变锚点、Pivot、父级尺寸或变换，会影响两者的换算。", "Basic preview position uses world coordinates with a bottom-left origin. Runtime shows layout values such as anchoredPosition and sizeDelta. Anchors, pivot, parent size and transforms affect how these values convert."),
    *pair("anchoredPosition 是 Pivot 相对锚点参考位置的偏移。拉伸锚点下，最终尺寸还包含父级尺寸贡献，不能把 sizeDelta 直接当作最终宽高。先稳定布局，再录制动画。", "anchoredPosition is the pivot offset from its anchor reference. With stretched anchors, final size also includes the parent's size contribution; sizeDelta is not simply final width or height. Stabilize layout before animating."),
    heading("画布操作", "Navigate the canvas"),
    *pair("滚轮缩放，中键拖动画布；通过三合一、移动、旋转、缩放工具调整选中控件。右上角可切换设备和画布比例，或点击适应画布。", "Use the wheel to zoom and middle-drag to pan. Manipulate the selection with the combined, move, rotate or scale tool. The top right provides device/aspect presets and Fit to view."),
    heading("先看播放头再修改", "Check the playhead before editing"),
    *pair("没有轨道的属性通常修改基础值；已有关键帧轨道的可动画属性会在当前播放头新增或更新关键帧。显隐、激活与编辑器锁定是不同设置，锁定不导出为游戏控件属性。", "An untracked property normally changes its base value. An animatable property with a track adds or updates a key at the current playhead. Visibility, activation and editor locking are distinct; locking is editor-only."),
])

# 06 / Keyframes
page("关键帧与属性轨道", "Keyframes and property tracks", "animation", [
    heading("一条属性对应一条轨道", "One property per track"),
    *pair("在时间轴节点旁点击加号，从可动画参数中选择位置、缩放、旋转、颜色或显隐等字段。XY 组合会分别创建两条属性轨道。实际可用字段随控件类型变化。", "Click the plus beside a timeline node to choose an animatable field, such as position, scale, rotation, color or visibility. An XY group creates two independent property tracks. Available fields depend on control type."),
    heading("添加、选择与移动", "Add, select and move keys"),
    *pair("双击属性轨道空白处添加关键帧，也可以使用右键菜单。点击菱形选中，拖动改变时间；在关键帧参数中精确设置时间和值。相同属性同一时刻不能堆叠多个关键帧。", "Double-click an empty property lane or use its context menu to add a key. Select a diamond, drag it in time, or enter an exact time and value in the keyframe inspector. One property cannot have duplicate keys at the same instant."),
    heading("补间与阶跃", "Tween and step interpolation"),
    *pair("「到下一帧」决定从当前关键帧到下一关键帧的变化：补间会连续变化，阶跃保持当前值后在下一帧切换。缓动也设置在起始关键帧上，控制这一段而不是上一段。", "To next keyframe controls the outgoing segment. Tween changes continuously; step holds the current value until the next key. Easing also belongs to the starting key and controls its outgoing segment."),
    *pair("显隐是布尔状态，只支持阶跃切换。最后一帧之后保持最后的值。拖动播放头只预览对应时刻；正式播放才会派发时间轴事件。", "Visibility is a boolean state and uses step changes only. Values hold after the last key. Scrubbing previews a time; timeline events are dispatched during playback."),
    heading("吸附、时长与帧率", "Snapping, duration and frame rate"),
    *pair("开启吸附便于对齐帧网格和其他关键时间。帧率用于帧刻度与时间操作，动画数据仍使用秒；30f 在 30 FPS 下是 1 秒。序列时长不能缩短到最后关键帧之前。", "Enable snapping to align frame grids and other key times. Frame rate controls frame labels and time operations; animation data uses seconds. At 30 FPS, 30f is 1 second. Duration cannot be reduced below the last key."),
    *pair("轨道左侧的菱形按钮可在当前播放头添加或选择关键帧；右键菜单也可删除当前关键帧或整条属性轨道。删除整条轨道前先确认范围，必要时使用撤销。", "The diamond button beside a track adds or selects a key at the playhead. The context menu can delete a key or the entire property track. Check the scope before deleting a track, and use Undo when needed."),
])

# 07 / Multi-animation and relative values
page("多动画、缓动与增量", "Animations, easing and relative values", "animation", [
    heading("一个文件中的多个 Animation", "Multiple animations in one file"),
    *pair("在动画列表新建、复制、重命名或删除 Animation，至少保留一个。所有动画共用控件层级与基础参数，但关键帧、事件和时长分别保存。", "Create, duplicate, rename or delete animations in the Animations panel; at least one remains. They share the control hierarchy and base parameters, while keyframes, events and duration are independent."),
    *pair("可以分别制作 Enter、Idle、Exit。编辑前确认当前选中的动画；导出 Timeline Data 也以当前动画为准，不会一次打包整个列表。", "For example, create Enter, Idle and Exit separately. Check the selected animation before editing. Timeline Data export uses the active animation, not every animation in the list."),
    heading("让动作更自然", "Shape the motion"),
    *pair("Linear 匀速，OutCubic 常用于入场减速，InCubic 常用于离场加速。先用两帧确认起止值，再调整起始帧的缓动；选择曲线时留意中间是否超出预期范围。", "Linear is constant speed; OutCubic often suits a decelerating entrance, and InCubic an accelerating exit. Verify start/end values with two keys first, then tune easing on the first key. Inspect any overshoot."),
    heading("绝对值与基于上一帧的增量", "Absolute values and previous-key deltas"),
    *pair("支持增量的字段可开启「基于上一帧增量」。后续帧相对同轨道上一关键帧的实际结果累加；首帧在游戏中以创建动画前的属性为基准。", "Supported fields can use previous-key deltas. Later keys add to the previous key's resolved value on the same track; the first key uses the property's value before runtime sequence creation."),
    *pair("示例：基础 X 为 100，第一帧增量 +20 得到 120，第二帧增量 +30 得到 150。增量不是每帧重复加一次，也不是按百分比缩放；没有该开关的字段不能按增量编辑。", "Example: base X = 100, first delta +20 resolves to 120, and the next delta +30 resolves to 150. A delta is not added every rendered frame and is not a percentage multiplier. Fields without this option do not support it."),
    heading("颜色与组透明度", "Color and group opacity"),
    *pair("颜色、单独 Alpha 与组透明度可能存在轨道冲突；遇到禁用提示时先检查已有颜色轨道。组透明度用于统一淡入淡出，游戏中的基础颜色和 Alpha 仍需合理设置。", "Color, individual alpha and group-opacity tracks can conflict. If a field is disabled, inspect existing color tracks. Use group opacity for a shared fade, with sensible base colors and alpha in the game."),
])

# 08 / Images
page("图片资源、图元与 PSD", "Images, primitives and PSD", "assets", [
    heading("图片资源与拟合", "Image resources and fitting"),
    *pair("工具栏「图片资源」管理当前文件的原图、拟合参数和结果。图元控件引用这些资源；同一资源可由多个控件共用。替换原图会清除旧拟合结果，需要重新生成。", "Image resources manages originals, fitting settings and results for the current file. Primitive controls reference these shared resources. Replacing an original clears its old fit and requires regeneration."),
    *pair("原图用于对照，图元预览使用游戏中的矩形、椭圆和三角形素材近似图像。数量越高通常越复杂；分辨率与并行数影响精度、耗时和内存。先低量测试，再提高。", "Original view is a reference; primitive view approximates it with game rectangles, ellipses and triangles. More primitives usually mean greater complexity. Resolution and workers affect accuracy, time and memory. Start small."),
    *pair("「一键生成缺失图元」只处理没有结果的资源，已有结果跳过。取消后可以再次运行以处理剩余资源；切换原图和拟合预览不会替代导出。", "Generate missing primitives processes resources without a result and skips completed ones. Run it again after cancellation to continue remaining work. Switching preview modes does not export anything."),
    heading("导入 PSD", "Import PSD"),
    *pair("从导入菜单选择 PSD，在当前工作区创建新编辑文件。文件夹变为容器，图层转为内嵌图片资源和对应图元控件，保留层级、位置、叠放与隐藏状态。拟合需另行生成。", "Import PSD creates a new editing file. Folders become containers, and layers become embedded image resources with primitive controls. Hierarchy, position, stacking and hidden state are retained. Generate fits separately."),
    *pair("当前支持 8 位 RGB 或灰度 PSD；文件上限 128 MB，最多 1024 个图层与文件夹。特殊混合、剪贴蒙版和图层样式不保证与 Photoshop 合成结果一致，留意导入提示。", "Current support covers 8-bit RGB/grayscale PSD, up to 128 MB and 1,024 layers/folders. Special blend modes, clipping masks and layer styles may differ from Photoshop's composite. Read the import notices."),
    heading("游戏中显示图元", "Display primitives in game"),
    *pair("GIA 导出会为图元保留同名容器。还需分别导出「图元项目 Lua」与「图元运行库」，在这些容器下创建实际图片；仅切换为拟合预览并不会把图元烘焙进 GIA。", "GIA export keeps a named container for each primitive control. Export the primitive project Lua and primitive runtime separately to create actual images under those containers. Fitted preview is not baked into GIA."),
])

# 09 / Advanced asset types
page("骨骼、Spine 与动效", "Bones, Spine and effects", "assets", [
    heading("骨骼模式", "Bone mode"),
    *pair("点击「以骨骼模式使用」展开骨骼工具，用容器表达父子骨骼关系；可以调整方向标记长度，并在骨骼创建模式中建立层级。方向标记用于编辑辅助，不等同于蒙皮网格。", "Enable bone mode to expose bone tools and use containers as parented bones. Adjust direction-marker length and build the hierarchy in bone creation mode. Direction markers are editing aids, not skinned meshes."),
    heading("导入 Spine 文件夹", "Import a Spine folder"),
    *pair("选择包含 skeleton.json 和原始图片的文件夹。优先使用 skeleton.json；缺图、同名图片歧义或多个骨骼 JSON 候选会报错。只有 .spine 文件时，需先从 Spine 导出 JSON。", "Choose a folder containing skeleton.json and original images. skeleton.json is preferred. Missing/ambiguous images or multiple skeleton JSON candidates cause an error. A .spine file alone must first be exported to JSON in Spine."),
    *pair("当前面向 Spine 3.8：支持 FK 层级、默认皮肤的普通 region 附件、多动画、位移、旋转和 XY 缩放。贝塞尔曲线以 30 Hz 采样近似为线性关键帧。", "Current support targets Spine 3.8: FK hierarchy, default-skin region attachments, multiple animations, translation, rotation and XY scale. Bezier curves are approximated with linear keys sampled at 30 Hz."),
    *pair("不支持 Spine 4.x、mesh/蒙皮、atlas 裁图与剪切。约束、附件切换、draw order、deform 和 Spine 事件等不会完整还原；导入后逐个动画核对，勿视作无损转换。", "Spine 4.x, meshes/skinning, atlas cropping and clipping are unsupported. Constraints, attachment changes, draw order, deform and Spine events are not fully restored. Review each imported animation; this is not a lossless conversion."),
    heading("界面动效与全屏特效", "UI and fullscreen effects"),
    *pair("添加对应控件后，在属性面板选择资源，可按播放类型或标签筛选并预览。全屏动效的变换仅影响子级控件；资源缺失、网络失败或渲染差异需在游戏中再次核对。", "Add the corresponding control, choose an effect in its inspector, then filter by playback type or tags and preview it. Fullscreen-effect transforms affect child controls only. Check missing assets, network failures and rendering differences in game."),
    heading("先完成基础，再增加复杂素材", "Add complexity after the basics"),
    *pair("先完成一个普通控件的位移动画及导出链路，再加入骨骼、图元或动效。这样更容易判断问题来自布局、动画还是素材转换。", "Verify a simple control animation and the export pipeline before adding bones, primitives or effects. This makes layout, animation and conversion issues easier to isolate."),
])

# 10 / Events
page("时间轴事件", "Timeline events", "events", [
    heading("在指定时刻派发业务信号", "Dispatch a signal at a chosen time"),
    *pair("在「事件」轨道点击加号，于当前播放头添加事件；也可双击空白处。设置时间、名称、目标控件和字符串参数后点击应用。拖动标记调整时间。", "Click the plus on the Events track to add an event at the playhead, or double-click an empty area. Set time, name, target and string parameters, then Apply. Drag the marker to retime it."),
    *pair("同一时刻可有多个事件，列表中的顺序决定它们的执行顺序。参数最多 4096 字，按字符串传递，不会自动解析 JSON，也不会当作 Lua 执行。", "Multiple events may share a time; their list order determines dispatch order. Parameters are strings up to 4,096 characters. They are not automatically parsed as JSON or executed as Lua."),
    heading("网页预览与游戏回调", "Browser preview and game callbacks"),
    *pair("网页播放只记录事件日志，不会执行你的游戏逻辑；拖动播放头不触发事件。重新从起点播放或循环时会再次触发，暂停后继续不会重复派发已越过的事件。", "Browser playback records events in a log; it does not execute your game logic. Scrubbing dispatches no events. Restarting from the beginning or looping can dispatch again; resuming does not repeat events already passed."),
    *pair("使用 TweenTimelineLib.Create(root, Data, {onEvent = handler}) 注册处理器。handler(event, target) 接收事件数据和已解析的目标控件；根据 event.name 自行分发业务逻辑。", "Register a handler using TweenTimelineLib.Create(root, Data, {onEvent = handler}). handler(event, target) receives event data and the resolved target control. Dispatch your behavior according to event.name."),
    heading("导出范围与目标", "Export scope and targets"),
    *pair("目标路径以所选导出根为基准；范围外目标的事件不导出。没有指定目标的事件使用导出根；导回网页时绑定到所选导入根。删除目标控件也会清理关联事件。", "Target paths are relative to the selected export root. Events targeting controls outside that scope are omitted. Events without a target use the export root and bind to the selected root on import. Deleting a target removes its related events."),
    heading("接入检查", "Integration checks"),
    *pair("使用当前 v8.3 运行库；不传 onEvent 时事件被忽略，但属性动画仍可播放。不要依赖事件与同刻属性更新的引擎先后顺序；循环、重播和销毁时机需在游戏中验证。", "Use the current v8.3 runtime. Without onEvent, events are ignored while property animation still works. Do not assume an engine ordering between an event and same-time property updates. Test loop, restart and destruction behavior in game."),
])

# 11 / Export formats
page("选择正确的导出方式", "Choose the right export", "export", [
    *pair("保存工程、导出游戏布局和导出动画，是三个不同环节。需要在游戏中复现结果时，按用途准备相应文件。", "Saving an editable project, exporting game layout and exporting animation are separate steps. Prepare the files needed for each part of the in-game result."),
    table([
        [("导出内容", "Output"), ("入口", "Menu"), ("用途与范围", "Purpose and scope")],
        [("JSON 工程", "JSON project"), ("导出 > JSON", "Export > JSON"), ("完整编辑备份，可重新导入网页。", "Editable project backup for browser reimport.")],
        [("GIA", "GIA layout"), ("导出 > GIA", "Export > GIA"), ("控件布局与基础参数；时间轴另行导出。", "Control layout and base values; export timelines separately.")],
        [("Timeline Data", "Timeline Data Lua"), ("Lua 工具 > 导出 Timeline Data", "Lua tools > Export Timeline Data"), ("当前动画，所选根及其后代范围。", "Active animation within the selected root and descendants.")],
        [("TweenTimelineLib", "Tween runtime"), ("Lua 工具 > 导出TweenTimeline运行库", "Lua tools > Export tween runtime"), ("读取、验证和播放 Timeline Data。", "Loads, validates and plays timeline data.")],
        [("图元项目与运行库", "Primitive project + runtime"), ("Lua 工具 > 图元相关导出", "Lua tools > Primitive exports"), ("拟合图片专用，需独立接入。", "Separate integration for fitted images.")],
    ], [104, 158, CW - 262]),
    Spacer(1, 10),
    heading("导出前先选根控件", "Select an export root first"),
    *pair("选中包含目标动画的容器，再导出当前动画数据。路径不包含根名称，空路径代表根本身。不要在游戏里随意更改同名控件层级，也不要把脚本挂到不对应的容器。", "Select the container that owns the intended animation before exporting. Paths exclude the root name; an empty path means the root itself. Keep the matching in-game hierarchy and attach playback to the corresponding root."),
    heading("推荐交付组合", "Recommended delivery set"),
    *pair("保留 JSON 备份；游戏使用 GIA 布局、每个需要的 Animation 的 Data，以及匹配版本的运行库。更新编辑器后如出现版本提示，重新导出并替换运行库。", "Keep a JSON backup. For game use, prepare the GIA layout, separate Data for each required animation and a matching runtime. If a version warning appears after an editor update, export and replace the runtime again."),
])

# 12 / Integration
page("游戏接入与数据导回", "Runtime integration and data import", "integration", [
    *pair("1. 将 GIA 布局导入游戏编辑器，核对根容器与后代名称。2. 将运行库和 Data 加入客户端 Lua 脚本资源，记录实际资源路径。3. 在对应导出根的客户端脚本中创建并播放动画。", "1. Import the GIA layout and verify the root and child names. 2. Register the runtime and Data as client Lua script resources and note their actual paths. 3. Create and play the animation in the client script for the matching export root."),
    heading("最小调用示例", "Minimal integration example"),
    *pair("以下假设资源路径为 Lib/TweenTimelineLib 和 Data/MyTimelineData；实际 require 路径需与你的脚本资源一致。script.object 必须对应导出时选中的根控件。", "This example assumes module paths Lib/TweenTimelineLib and Data/MyTimelineData. Use the paths registered in your project. script.object must match the root selected during export."),
    Preformatted('local TweenTimelineLib = require("Lib.TweenTimelineLib")\nlocal Data = require("Data.MyTimelineData")\n\nlocal sequence = TweenTimelineLib.Create(script.object, Data, {\n    onEvent = function(event, target)\n        if event.name == "ShowDialogue" then\n            print(event.params)\n        end\n    end,\n})\nsequence:Play()\n\n-- Call when the owner is destroyed / no longer needed:\n-- sequence:Kill(false)', STYLES["code"]),
    Spacer(1, 8),
    *pair("把创建逻辑放入适合项目的初始化流程；持有返回的 sequence，在持有者销毁时释放。示例展示库调用方式，不替代项目中的脚本生命周期与业务逻辑。", "Place creation in your project's initialization flow. Keep the returned sequence and release it when its owner is destroyed. This shows library usage; integrate it with your actual lifecycle and game logic."),
    heading("把 Timeline Data 导回网页", "Import Timeline Data back into the editor"),
    *pair("在「Lua 工具 > 导入 Timeline Data」粘贴 Data 或选择 .lua/.txt 文件，选择匹配根控件，检查预览及相对路径匹配，再确认追加或替换模式。这里导入的是数据模块，不是整个业务脚本。", "In Lua tools > Import Timeline Data, paste Data or select a .lua/.txt file. Select the matching root, review validation and relative-path matches, then choose append or replace. Import the data module, not a complete game script."),
    *pair("替换只针对预览显示的所选根范围，不等于导入完整工程。需要恢复全部编辑资源与多个动画时，使用 JSON 工程备份。", "Replace affects the selected-root scope shown in the preview; it does not restore an entire project. Use JSON to restore all editing resources and multiple animations."),
])

# 13 / Shortcuts
page("常用操作与快捷键", "Everyday actions and shortcuts", "reference", [
    *pair("快捷键与当前焦点有关。在文本输入框中，复制、粘贴和删除仍是文字编辑；操作时间轴前先点击对应区域。", "Shortcuts depend on focus. In text fields, copy, paste and delete retain their text-editing behavior. Click the relevant timeline region before using its shortcuts."),
    table([
        [("操作", "Action"), ("按键或手势", "Key or gesture"), ("说明", "Notes")],
        [("播放 / 暂停", "Play / pause"), ("空格", "Space"), ("输入文字时不触发。", "Ignored while editing text.")],
        [("撤销 / 重做", "Undo / redo"), ("Ctrl+Z / Ctrl+Shift+Z 或 Ctrl+Y", "Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y"), ("也可使用顶部按钮。", "Also available in the toolbar.")],
        [("复制 / 粘贴关键帧", "Copy / paste a key"), ("Ctrl+C / Ctrl+V", "Ctrl+C / Ctrl+V"), ("粘贴到原轨道的播放头；已有关键帧时不会覆盖。", "Paste to the original track at the playhead; occupied times are not overwritten.")],
        [("删除关键帧", "Delete a key"), ("Delete / Backspace", "Delete / Backspace"), ("先选中菱形，确保时间轴获得焦点。", "Select a diamond and focus the timeline first.")],
        [("精确移动播放头", "Nudge the playhead"), ("标尺聚焦后用左右方向键", "Left / Right with ruler focus"), ("每次 1 帧；Shift 为 10 帧；Home/End 到起止点。", "1 frame; Shift = 10 frames. Home/End jumps to start/end.")],
        [("缩放 / 平移画布", "Zoom / pan canvas"), ("滚轮 / 中键拖动", "Wheel / middle-drag"), ("右上角提供适应画布。", "Fit to view is at the top right.")],
        [("数值微调", "Adjust a number"), ("左右拖动数值", "Drag a numeric field"), ("Shift 精调，Ctrl 加速，双击输入；Esc 结束拖动。", "Shift for fine control, Ctrl for faster changes, double-click to type; Esc ends dragging.")],
        [("调整时间轴高度", "Resize the timeline"), ("拖动时间轴上边缘", "Drag the timeline's top edge"), ("双击边缘恢复自动高度。", "Double-click the edge to restore automatic height.")],
    ], [110, 163, CW - 273]),
    Spacer(1, 9),
    *pair("使用指南菜单支持方向键选择链接、Enter 打开、Esc 收起。B 站视频具有英文字幕，PDF 手册包含英文说明。", "In the User guide menu, use arrows to focus links, Enter to open and Esc to close. The video has English subtitles; the PDF includes English instructions."),
])

# 14 / Troubleshooting
page("问题排查与发布检查", "Troubleshooting and delivery checks", "finish", [
    table([
        [("现象", "Symptom"), ("先检查", "Check first")],
        [("网页里没有移动", "No motion in browser"), ("当前 Animation、轨道起止值、播放头与时长；先回到起点再播放。", "Active animation, distinct key values, playhead and duration; rewind before playing.")],
        [("缓动方向不对", "Wrong easing"), ("缓动在起始帧，作用于它到下一帧的区间；确认不是阶跃。", "Easing belongs to the outgoing segment on the starting key; check tween versus step.")],
        [("游戏里不播放", "No in-game playback"), ("资源 require 路径、匹配根、子级名称、当前 Data、运行库版本及 Play 调用。", "Module paths, matching root, child names, correct Data, runtime version and the Play call.")],
        [("位置或尺寸不一致", "Different position or size"), ("世界坐标与锚点偏移是否混用；锚点、Pivot、父级尺寸和层级是否变化。", "World versus anchored coordinates; changed anchors, pivot, parent size or hierarchy.")],
        [("事件没有执行", "Events do not run"), ("网页仅记录日志；游戏中检查 onEvent、目标范围、事件名与字符串参数。", "Browser preview only logs events. In game, inspect onEvent, scope, names and string parameters.")],
        [("图元图片缺失", "Missing primitive images"), ("是否生成拟合并导出图元项目、运行库；目标容器路径与图片模板索引是否正确。", "Generated fits, primitive project/runtime exports, target container paths and the image prefab index.")],
    ], [125, CW - 125]),
    Spacer(1, 8),
    heading("交付前核对", "Before delivery"),
    *pair("保存 JSON 备份；逐个检查所需 Animation；确认导出根、名称与版本；保留导入提示；在游戏中检查设备布局、播放、重播和资源释放。网页预览不能替代游戏内验证。", "Keep a JSON backup; review each required animation; verify root, names and versions; keep import notices; test device layouts, playback, restart and cleanup in game. Browser preview does not replace runtime testing."),
    heading("获取帮助", "Help and resources"),
    Paragraph(f'<link href="{VIDEO}" color="#3169CA">Bilibili video / English subtitles: BV1Qpau6cEUS</link>', STYLES["en"]),
    Paragraph(f'<link href="{HANDBOOK}" color="#3169CA">Latest handbook / Chinese + English PDF</link>', STYLES["en"]),
    *pair("本手册依据当前编辑器界面、关键帧导出逻辑，以及随项目维护的图元、Spine、时间轴事件说明编写。使用指南中的链接可获取视频和后续更新的手册。", "Prepared from the current editor UI, keyframe exporter and maintained notes on primitives, Spine and timeline events. Use the User guide menu for the video and updated handbook."),
])

assert PAGE == 14, PAGE
c.save()
print(f"Created {OUTPUT.resolve()} ({PAGE} pages)")
print("Page bottom positions (pt):", AUDIT)
