import { controlRegistry } from "./controlRegistry";
import type { ControlType, TweenEaseType, UITweenTrack, UINode } from "./types";

export type TweenValueKind = "number" | "color";
export type TweenFieldSource = "base" | "properties" | "group";

export interface TweenableFieldDefinition {
  /** 原生 API 字段名；source=group 是由运行库展开的编辑器组合字段。 */
  fieldKey: string;
  /** 当前编辑器模型中的字段名。 */
  modelKey: string;
  label: string;
  source: TweenFieldSource;
  valueKind: TweenValueKind;
  min?: number;
  max?: number;
  step?: number;
  /** 每移动一个鼠标像素时变化的数值，与输入精度分开设置。 */
  scrubSpeed?: number;
  description?: string;
}

export const GROUP_ALPHA_FIELD_KEY = "groupAlpha";
export const GROUP_ALPHA_MAX = 255;

/** 原生缩放字段；增量仍然是加法，不是倍率。 */
export function isScaleTweenField(fieldKey: string): boolean {
  return fieldKey === "localScaleX" || fieldKey === "localScaleY" || fieldKey === "localScaleZ";
}

export function isSizeTweenField(fieldKey: string): boolean {
  return fieldKey === "sizeDeltaX" || fieldKey === "sizeDeltaY";
}

/** 位置、大小和缩放 Clip 支持相对上一段终值（首段相对控件基础值）的增量。 */
export function isRelativeTweenField(fieldKey: string): boolean {
  return isScaleTweenField(fieldKey) || isSizeTweenField(fieldKey) || fieldKey === "anchoredPositionX" || fieldKey === "anchoredPositionY";
}

export function getTweenRelativeLabel(fieldKey: string): string {
  if (isSizeTweenField(fieldKey)) return "大小使用增量";
  return isScaleTweenField(fieldKey) ? "缩放使用增量" : "位置使用增量";
}

const groupTweenableFields: TweenableFieldDefinition[] = [{
  fieldKey: GROUP_ALPHA_FIELD_KEY,
  modelKey: GROUP_ALPHA_FIELD_KEY,
  label: "自身及子级透明度",
  source: "group",
  valueKind: "number",
  min: 0, max: GROUP_ALPHA_MAX, step: 1, scrubSpeed: 1,
  description: "0–255；255 保留各控件的基础透明度，0 完全透明。作用于自身及全部后代的图片、文字、文字背景和描边颜色，保留 RGB。",
}];

/** 只处理已确认的原生颜色字段，不给空容器附加不存在的 Color 属性。 */
export function getGroupAlphaColorFields(type: ControlType): string[] {
  return controlRegistry[type].fields
    .filter((field) => field.tweenable && field.kind === "color")
    .map((field) => field.key);
}

export function getTweenGroupNodes(rootId: string, nodes: UINode[]): UINode[] {
  const children = new Map<string, UINode[]>();
  for (const node of nodes) {
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }
  const root = nodes.find((node) => node.id === rootId);
  const pending = root ? [root] : [];
  const visited = new Set<string>();
  const result: UINode[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    result.push(node);
    pending.push(...(children.get(node.id) ?? []));
  }
  return result;
}

/** 原生颜色 Tween 不能同时被组合轨道和单独轨道写入；预览和导出采用同一规则。 */
export function getTweenTrackConflict(
  nodeId: string, fieldKey: string, nodes: UINode[], tracks: UITweenTrack[],
): string | null {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const isGroup = fieldKey === GROUP_ALPHA_FIELD_KEY;
  if (!isGroup && !getGroupAlphaColorFields(node.type).includes(fieldKey)) return null;
  const targets = new Set((isGroup ? getTweenGroupNodes(nodeId, nodes) : [node])
    .flatMap((target) => (isGroup ? getGroupAlphaColorFields(target.type) : [fieldKey])
      .map((key) => `${target.id}\0${key}`)));
  for (const track of tracks) {
    // 同一属性轨道的多个 Clip 由时间区间规则限制，不能当成不同颜色写入者。
    if (track.nodeId === nodeId && track.fieldKey === fieldKey) continue;
    const other = nodes.find((item) => item.id === track.nodeId);
    if (!other || (!isGroup && track.fieldKey !== GROUP_ALPHA_FIELD_KEY)) continue;
    const otherIsGroup = track.fieldKey === GROUP_ALPHA_FIELD_KEY;
    const overlap = (otherIsGroup ? getTweenGroupNodes(other.id, nodes) : [other]).some((target) =>
      (otherIsGroup ? getGroupAlphaColorFields(target.type) : [track.fieldKey])
        .some((key) => targets.has(`${target.id}\0${key}`)));
    if (overlap) return `与「${other.name}」的 ${track.fieldKey} 轨道控制同一颜色。请先移除该轨道，避免多个 Tween 同时改写颜色。`;
  }
  return null;
}

const pixelScrub = { step: 0.01, scrubSpeed: 1 };
const normalizedScrub = { min: 0, max: 1, step: 0.01, scrubSpeed: 0.005 };
const scaleScrub = { step: 0.01, scrubSpeed: 0.01 };
const rotationScrub = { step: 0.01, scrubSpeed: 1 };

export const baseTweenableFields: TweenableFieldDefinition[] = [
  { fieldKey: "anchoredPositionX", modelKey: "anchorOffsetX", label: "位置 X", source: "base", valueKind: "number", ...pixelScrub },
  { fieldKey: "anchoredPositionY", modelKey: "anchorOffsetY", label: "位置 Y", source: "base", valueKind: "number", ...pixelScrub },
  { fieldKey: "sizeDeltaX", modelKey: "sizeDeltaX", label: "大小 X", source: "base", valueKind: "number", ...pixelScrub },
  { fieldKey: "sizeDeltaY", modelKey: "sizeDeltaY", label: "大小 Y", source: "base", valueKind: "number", ...pixelScrub },
  { fieldKey: "anchorMinX", modelKey: "anchorMinX", label: "最小锚点 X", source: "base", valueKind: "number", ...normalizedScrub },
  { fieldKey: "anchorMinY", modelKey: "anchorMinY", label: "最小锚点 Y", source: "base", valueKind: "number", ...normalizedScrub },
  { fieldKey: "anchorMaxX", modelKey: "anchorMaxX", label: "最大锚点 X", source: "base", valueKind: "number", ...normalizedScrub },
  { fieldKey: "anchorMaxY", modelKey: "anchorMaxY", label: "最大锚点 Y", source: "base", valueKind: "number", ...normalizedScrub },
  { fieldKey: "pivotX", modelKey: "pivotX", label: "中心 X", source: "base", valueKind: "number", ...normalizedScrub },
  { fieldKey: "pivotY", modelKey: "pivotY", label: "中心 Y", source: "base", valueKind: "number", ...normalizedScrub },
  { fieldKey: "localScaleX", modelKey: "scaleX", label: "缩放 X", source: "base", valueKind: "number", ...scaleScrub },
  { fieldKey: "localScaleY", modelKey: "scaleY", label: "缩放 Y", source: "base", valueKind: "number", ...scaleScrub },
  { fieldKey: "localScaleZ", modelKey: "scaleZ", label: "缩放 Z", source: "base", valueKind: "number", ...scaleScrub },
  { fieldKey: "localRotationX", modelKey: "rotationX", label: "旋转 X", source: "base", valueKind: "number", ...rotationScrub },
  { fieldKey: "localRotationY", modelKey: "rotationY", label: "旋转 Y", source: "base", valueKind: "number", ...rotationScrub },
  { fieldKey: "localRotationZ", modelKey: "rotation", label: "旋转 Z", source: "base", valueKind: "number", ...rotationScrub },
];

export function getTweenableFields(type: ControlType): TweenableFieldDefinition[] {
  const derivedFields = controlRegistry[type].fields
    .filter((field) => field.tweenable)
    .map<TweenableFieldDefinition>((field) => ({
      fieldKey: field.key,
      modelKey: field.key,
      label: field.label,
      source: "properties",
      valueKind: field.kind === "color" ? "color" : "number",
      min: field.min,
      max: field.max,
      step: field.step ?? 0.01,
    }));
  return [...baseTweenableFields, ...derivedFields, ...groupTweenableFields];
}

export function getTweenableField(type: ControlType, fieldKey: string) {
  return getTweenableFields(type).find((field) => field.fieldKey === fieldKey) ?? null;
}

export const tweenEaseOptions: Array<{ value: TweenEaseType; label: string }> = [
  { value: "Linear", label: "线性" },
  { value: "InSine", label: "正弦 · 缓入" }, { value: "OutSine", label: "正弦 · 缓出" }, { value: "InOutSine", label: "正弦 · 缓入缓出" },
  { value: "InQuad", label: "二次 · 缓入" }, { value: "OutQuad", label: "二次 · 缓出" }, { value: "InOutQuad", label: "二次 · 缓入缓出" },
  { value: "InCubic", label: "三次 · 缓入" }, { value: "OutCubic", label: "三次 · 缓出" }, { value: "InOutCubic", label: "三次 · 缓入缓出" },
  { value: "InQuart", label: "四次 · 缓入" }, { value: "OutQuart", label: "四次 · 缓出" }, { value: "InOutQuart", label: "四次 · 缓入缓出" },
  { value: "InQuint", label: "五次 · 缓入" }, { value: "OutQuint", label: "五次 · 缓出" }, { value: "InOutQuint", label: "五次 · 缓入缓出" },
  { value: "InExpo", label: "指数 · 缓入" }, { value: "OutExpo", label: "指数 · 缓出" }, { value: "InOutExpo", label: "指数 · 缓入缓出" },
  { value: "InCirc", label: "圆形 · 缓入" }, { value: "OutCirc", label: "圆形 · 缓出" }, { value: "InOutCirc", label: "圆形 · 缓入缓出" },
  { value: "InBack", label: "回弹 · 缓入" }, { value: "OutBack", label: "回弹 · 缓出" }, { value: "InOutBack", label: "回弹 · 缓入缓出" },
  { value: "InElastic", label: "弹性 · 缓入" }, { value: "OutElastic", label: "弹性 · 缓出" }, { value: "InOutElastic", label: "弹性 · 缓入缓出" },
  { value: "InBounce", label: "弹跳 · 缓入" }, { value: "OutBounce", label: "弹跳 · 缓出" }, { value: "InOutBounce", label: "弹跳 · 缓入缓出" },
];

const tweenEaseTypeSet = new Set<TweenEaseType>(tweenEaseOptions.map((option) => option.value));

export function isTweenEaseType(value: unknown): value is TweenEaseType {
  return typeof value === "string" && tweenEaseTypeSet.has(value as TweenEaseType);
}

function outBounce(progress: number) {
  const scale = 7.5625;
  const divisor = 2.75;
  if (progress < 1 / divisor) return scale * progress * progress;
  if (progress < 2 / divisor) { const shifted = progress - 1.5 / divisor; return scale * shifted * shifted + 0.75; }
  if (progress < 2.5 / divisor) { const shifted = progress - 2.25 / divisor; return scale * shifted * shifted + 0.9375; }
  const shifted = progress - 2.625 / divisor;
  return scale * shifted * shifted + 0.984375;
}

/** 编辑器预览曲线；枚举名与运行时 Tween:SetEase 参数一致。 */
export function applyTweenEase(easeType: TweenEaseType, rawProgress: number) {
  const progress = Math.min(1, Math.max(0, rawProgress));
  const inverse = 1 - progress;
  const back1 = 1.70158;
  const back2 = back1 * 1.525;
  const back3 = back1 + 1;
  switch (easeType) {
    case "InSine": return 1 - Math.cos(progress * Math.PI / 2);
    case "OutSine": return Math.sin(progress * Math.PI / 2);
    case "InOutSine": return -(Math.cos(Math.PI * progress) - 1) / 2;
    case "InQuad": return progress * progress;
    case "OutQuad": return 1 - inverse * inverse;
    case "InOutQuad": return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    case "InCubic": return progress * progress * progress;
    case "OutCubic": return 1 - inverse * inverse * inverse;
    case "InOutCubic": return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    case "InQuart": return Math.pow(progress, 4);
    case "OutQuart": return 1 - Math.pow(inverse, 4);
    case "InOutQuart": return progress < 0.5 ? 8 * Math.pow(progress, 4) : 1 - Math.pow(-2 * progress + 2, 4) / 2;
    case "InQuint": return Math.pow(progress, 5);
    case "OutQuint": return 1 - Math.pow(inverse, 5);
    case "InOutQuint": return progress < 0.5 ? 16 * Math.pow(progress, 5) : 1 - Math.pow(-2 * progress + 2, 5) / 2;
    case "InExpo": return progress === 0 ? 0 : Math.pow(2, 10 * progress - 10);
    case "OutExpo": return progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    case "InOutExpo": return progress === 0 || progress === 1 ? progress : progress < 0.5 ? Math.pow(2, 20 * progress - 10) / 2 : (2 - Math.pow(2, -20 * progress + 10)) / 2;
    case "InCirc": return 1 - Math.sqrt(1 - progress * progress);
    case "OutCirc": return Math.sqrt(1 - Math.pow(progress - 1, 2));
    case "InOutCirc": return progress < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * progress, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * progress + 2, 2)) + 1) / 2;
    case "InBack": return back3 * progress * progress * progress - back1 * progress * progress;
    case "OutBack": return 1 + back3 * Math.pow(progress - 1, 3) + back1 * Math.pow(progress - 1, 2);
    case "InOutBack": return progress < 0.5 ? Math.pow(2 * progress, 2) * ((back2 + 1) * 2 * progress - back2) / 2 : (Math.pow(2 * progress - 2, 2) * ((back2 + 1) * (progress * 2 - 2) + back2) + 2) / 2;
    case "InElastic": { const period = 2 * Math.PI / 3; return progress === 0 || progress === 1 ? progress : -Math.pow(2, 10 * progress - 10) * Math.sin((10 * progress - 10.75) * period); }
    case "OutElastic": { const period = 2 * Math.PI / 3; return progress === 0 || progress === 1 ? progress : Math.pow(2, -10 * progress) * Math.sin((10 * progress - 0.75) * period) + 1; }
    case "InOutElastic": { const period = 2 * Math.PI / 4.5; return progress === 0 || progress === 1 ? progress : progress < 0.5 ? -(Math.pow(2, 20 * progress - 10) * Math.sin((20 * progress - 11.125) * period)) / 2 : Math.pow(2, -20 * progress + 10) * Math.sin((20 * progress - 11.125) * period) / 2 + 1; }
    case "InBounce": return 1 - outBounce(1 - progress);
    case "OutBounce": return outBounce(progress);
    case "InOutBounce": return progress < 0.5 ? (1 - outBounce(1 - 2 * progress)) / 2 : (1 + outBounce(2 * progress - 1)) / 2;
    case "Linear": default: return progress;
  }
}
