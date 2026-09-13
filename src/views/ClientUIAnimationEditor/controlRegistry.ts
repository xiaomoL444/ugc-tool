import type { ColorRGBA, ControlPropertiesMap, ControlType } from "./types";

export interface PropertyOption { label: string; value: string }
export type ControlPropertyFieldKind = "text" | "textarea" | "number" | "boolean" | "nullableBoolean" | "select" | "color";
export interface ControlPropertyField {
  key: string;
  label: string;
  kind: ControlPropertyFieldKind;
  options?: PropertyOption[];
  min?: number;
  max?: number;
  step?: number;
  runtimeReadOnly?: boolean;
  tweenable?: boolean;
  description?: string;
}

export interface ControlDefinition<T extends ControlType> {
  type: T;
  label: string;
  icon: string;
  description: string;
  runtimeClass: string;
  editorOnly?: boolean;
  defaultName: string;
  defaultWidth: number;
  defaultHeight: number;
  fields: ControlPropertyField[];
  createProperties: () => ControlPropertiesMap[T];
}

const color = (hex: string, a = 1): ColorRGBA => ({ r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16), a });
const option = (value: string, label: string): PropertyOption => ({ value, label });
const nullableBoolean = (key: string, label: string, runtimeReadOnly = false): ControlPropertyField => ({ key, label, kind: "nullableBoolean", runtimeReadOnly });
const boolean = (key: string, label: string): ControlPropertyField => ({ key, label, kind: "boolean" });
const number = (key: string, label: string, config: Partial<ControlPropertyField> = {}): ControlPropertyField => ({ key, label, kind: "number", ...config });
const select = (key: string, label: string, options: PropertyOption[], config: Partial<ControlPropertyField> = {}): ControlPropertyField => ({ key, label, kind: "select", options, ...config });
const colorField = (key: string, label: string, tweenable = true): ControlPropertyField => ({ key, label, kind: "color", tweenable });

const textFields: ControlPropertyField[] = [
  { key: "text", label: "文本内容", kind: "textarea" },
  number("fontSize", "字号", { min: 1, step: 1, tweenable: true }),
  colorField("fontColor", "文本颜色"),
  colorField("bgColor", "背景颜色"),
  boolean("enableOutline", "启用文字描边"),
  colorField("outlineColor", "描边颜色"),
  select("horizontalAlignment", "水平对齐", [option("left", "左"), option("middle", "居中"), option("right", "右")]),
  select("verticalAlignment", "垂直对齐", [option("top", "顶部"), option("middle", "居中"), option("bottom", "底部")]),
  boolean("adaptiveFontSize", "字号自适应"),
  number("minimumFontSize", "最小字号", { min: 1, step: 1 }),
];

const keyboardKeyOptions = [
  ...Array.from({ length: 43 }, (_, index) => option(`CraftspersonKey${index + 1}`, `奇匠按键 ${index + 1}`)),
  ...["MoveForwardKey", "MoveBackwardKey", "MoveLeftKey", "MoveRightKey", "SwitchToWalkOrRunKey", "SprintKey", "JumpKey", "DropKey", "OpenShortcutWheelKey", "InteractKey", "NormalAttackKey", "CharacterSkill1Key", "CharacterSkill2Key", "CharacterSkill3Key", "CharacterSkill4Key", "None"].map((name) => option(name, name)),
];
const controllerKeyOptions = [
  ...Array.from({ length: 14 }, (_, index) => option(`CraftspersonKey${index + 1}`, `奇匠按键 ${index + 1}`)),
  ...["SprintKey", "JumpKey", "InteractKey", "NormalAttackKey", "CharacterSkill1Key", "CharacterSkill2Key", "CharacterSkill3Key", "CharacterSkill4Key", "MenuConfirmKey", "MenuBackKey", "None"].map((name) => option(name, name)),
];

export const controlRegistry: { [T in ControlType]: ControlDefinition<T> } = {
  primitive: {
    type: "primitive", label: "图元控件", icon: "▧", description: "图片拟合、游戏图元预览与参数导出", runtimeClass: "ClientUIContainerControl", editorOnly: true,
    defaultName: "Primitive", defaultWidth: 150, defaultHeight: 150,
    fields: [{ key: "imageResourceId", label: "图片资源", kind: "text" }], createProperties: () => ({ imageUrl: "", imageResourceId: null, previewMode: "image" }),
  },
  container: {
    type: "container", label: "容器节点", icon: "▣", description: "组织子控件与输入穿透", runtimeClass: "ClientUIContainerControl", defaultName: "Container", defaultWidth: 280, defaultHeight: 180,
    fields: [boolean("isolateNavigation", "隔离手柄导航"), boolean("disableKeyEventPassthrough", "屏蔽按键事件穿透"), boolean("disableCursorEventPassthrough", "屏蔽点击事件穿透"), boolean("showCursor", "显示常驻光标")],
    createProperties: () => ({ isolateNavigation: false, disableKeyEventPassthrough: false, disableCursorEventPassthrough: false, showCursor: false }),
  },
  image: {
    type: "image", label: "图片", icon: "▧", description: "图片、遮罩与填充效果", runtimeClass: "ClientUIImageControl", defaultName: "Image", defaultWidth: 150, defaultHeight: 150,
    fields: [
      select("imageSource", "图片来源", [option("staticReference", "静态引用"), option("item", "道具"), option("equipment", "装备"), option("skill", "技能"), option("unitStatus", "单位状态"), option("faction", "阵营"), option("currency", "货币"), option("prefab", "元件")], { runtimeReadOnly: true }),
      number("imageId", "图片 ID", { step: 1, runtimeReadOnly: true }), colorField("imageColor", "图片颜色"), select("imageType", "图片类型", [option("basic", "基础"), option("stretch", "拉伸")]),
      boolean("enableMask", "启用遮罩"), boolean("enableSoftEdge", "启用边缘羽化"), select("softEdgeMode", "羽化模式", [option("percentage", "按比例"), option("pixel", "按像素")]),
      number("softEdgeWidthX", "水平羽化宽度", { tweenable: true }), number("softEdgeWidthY", "垂直羽化宽度", { tweenable: true }), number("horizontalSoftRange", "水平羽化范围", { tweenable: true }), number("verticalSoftRange", "垂直羽化范围", { tweenable: true }),
      boolean("reverseMaskArea", "反转遮罩区域"), select("fillType", "填充方式", [option("unused", "不使用"), option("horizontal", "水平"), option("vertical", "垂直"), option("radial90", "90° 环绕"), option("radial180", "180° 环绕"), option("radial360", "360° 环绕")]),
      select("fillHorizontalType", "水平填充方向", [option("left", "从左"), option("right", "从右")]), select("fillVerticalType", "垂直填充方向", [option("bottom", "从底部"), option("top", "从顶部")]),
      select("fillRadial90Type", "90° 径向起点", [option("bottomLeft", "左下"), option("topLeft", "左上"), option("topRight", "右上"), option("bottomRight", "右下")]), select("fillRadialType", "径向起点", [option("bottom", "底部"), option("left", "左侧"), option("top", "顶部"), option("right", "右侧")]),
      number("fillAmount", "填充量", { min: 0, max: 1, step: 0.01, tweenable: true }),
    ],
    createProperties: () => ({ imageSource: "staticReference", imageId: 100001, imageColor: color("#ffffff"), imageType: "basic", enableMask: false, enableSoftEdge: false, softEdgeMode: null, softEdgeWidthX: null, softEdgeWidthY: null, horizontalSoftRange: null, verticalSoftRange: null, reverseMaskArea: false, fillType: "unused", fillHorizontalType: null, fillVerticalType: null, fillRadial90Type: null, fillRadialType: null, fillAmount: null }),
  },
  text: {
    type: "text", label: "文本框", icon: "T", description: "显示普通文本", runtimeClass: "ClientUITextBoxControl", defaultName: "TextBox", defaultWidth: 360, defaultHeight: 90, fields: textFields,
    createProperties: () => ({ text: "", fontSize: 20, fontColor: color("#ffffff"), bgColor: color("#ffffff", 0), enableOutline: false, outlineColor: color("#333333", 0.2), horizontalAlignment: "middle", verticalAlignment: "middle", adaptiveFontSize: false, minimumFontSize: 10 }),
  },
  textWindow: {
    type: "textWindow", label: "文本视窗", icon: "▤", description: "显示可滚动文本", runtimeClass: "ClientUITextWindowControl", defaultName: "TextWindow", defaultWidth: 420, defaultHeight: 240, fields: [boolean("interactable", "允许交互"), boolean("showScrollBar", "显示滚动条"), ...textFields],
    createProperties: () => ({ interactable: true, showScrollBar: true, text: "", fontSize: 20, fontColor: color("#ffffff"), bgColor: color("#ffffff", 0), enableOutline: false, outlineColor: color("#333333", 0.2), horizontalAlignment: "left", verticalAlignment: "top", adaptiveFontSize: false, minimumFontSize: 10 }),
  },
  presetButton: {
    type: "presetButton", label: "预设按钮", icon: "◉", description: "带点击事件的预设按钮", runtimeClass: "ClientUIPresetButtonControl", defaultName: "PresetButton", defaultWidth: 220, defaultHeight: 72,
    fields: [boolean("interactable", "允许交互"), number("clickAudioId", "点击音效 ID", { step: 1 }), boolean("raycastTarget", "光标射线检测")], createProperties: () => ({ interactable: true, clickAudioId: null, raycastTarget: true }),
  },
  cursorEventArea: {
    type: "cursorEventArea", label: "光标检测区域", icon: "⌁", description: "透明的光标命中区域", runtimeClass: "ClientUICursorEventAreaControl", defaultName: "CursorEventArea", defaultWidth: 240, defaultHeight: 140,
    fields: [boolean("raycastTarget", "光标射线检测")], createProperties: () => ({ raycastTarget: true }),
  },
  gridScroller: {
    type: "gridScroller", label: "网格视窗", icon: "▦", description: "滚动与复用条目列表", runtimeClass: "ClientUIGridScrollerControl", defaultName: "GridScroller", defaultWidth: 420, defaultHeight: 300,
    fields: [number("itemCount", "列表项数量", { step: 1, min: 0, runtimeReadOnly: true }), number("itemPrefabIndex", "条目预制索引", { step: 1 }), boolean("raycastTarget", "光标射线检测"), boolean("showScrollBar", "显示滚动条"), boolean("interactable", "允许交互"), select("scrollDirection", "滚动方向", [option("horizontal", "水平"), option("vertical", "垂直")], { runtimeReadOnly: true }), select("layoutConstraint", "布局约束", [option("autoWrap", "自动换行"), option("fixed", "固定行/列")], { runtimeReadOnly: true }), number("layoutConstraintFixedCount", "固定行/列数量", { step: 1, min: 0, runtimeReadOnly: true }), number("scrollProgress", "滚动进度", { min: 0, max: 1, step: 0.01, tweenable: true })],
    createProperties: () => ({ itemCount: null, itemPrefabIndex: null, raycastTarget: true, showScrollBar: true, interactable: true, scrollDirection: null, layoutConstraint: null, layoutConstraintFixedCount: null, scrollProgress: null }),
  },
  keyHint: {
    type: "keyHint", label: "按键提示", icon: "⌨", description: "按输入设备显示对应按键", runtimeClass: "ClientUIKeyHintControl", defaultName: "KeyHint", defaultWidth: 180, defaultHeight: 64,
    fields: [select("keyboardKeyCode", "键鼠按键", keyboardKeyOptions), select("controllerKeyCode", "手柄按键", controllerKeyOptions)], createProperties: () => ({ keyboardKeyCode: "None", controllerKeyCode: "None" }),
  },
  uiAnimation: {
    type: "uiAnimation", label: "界面动效", icon: "✦", description: "播放界面动效", runtimeClass: "ClientUIAnimationControl", defaultName: "UIAnimation", defaultWidth: 240, defaultHeight: 140,
    fields: [number("animationId", "动效 ID", { step: 1 }), boolean("playSoundEffect", "播放动效音效"), select("layer", "动效层级", [option("aboveAllControls", "所有控件之上"), option("belowAllControls", "所有控件之下")])], createProperties: () => ({ animationId: null, playSoundEffect: true, layer: null }),
  },
  fullscreenAnimation: {
    type: "fullscreenAnimation", label: "全屏动效", icon: "✧", description: "覆盖界面的全屏动效", runtimeClass: "ClientUIFullscreenAnimationControl", defaultName: "FullscreenAnimation", defaultWidth: 640, defaultHeight: 360,
    fields: [number("animationId", "动效 ID", { step: 1 }), boolean("playSoundEffect", "播放动效音效")], createProperties: () => ({ animationId: null, playSoundEffect: true }),
  },
  reference: {
    type: "reference", label: "模板引用控件", icon: "↗", description: "引用已配置的界面资源", runtimeClass: "ClientUIReferenceControl", defaultName: "Reference", defaultWidth: 320, defaultHeight: 180,
    fields: [number("referencedPrefabIndex", "引用预制索引", { step: 1, runtimeReadOnly: true })], createProperties: () => ({ referencedPrefabIndex: null }),
  },
};

export const controlDefinitions = Object.values(controlRegistry) as Array<ControlDefinition<ControlType>>;
export function getControlDefinition<T extends ControlType>(type: T): ControlDefinition<T> { return controlRegistry[type]; }
export function createControlProperties<T extends ControlType>(type: T): ControlPropertiesMap[T] { return controlRegistry[type].createProperties(); }
