import { decode, type ConverterDocument, type UgcValue } from "genshin-impact-ugc-file-converter-web";
import type { ColorRGBA, ControlType } from "./types";

type GiaObject = Record<string, UgcValue>;

export interface GiaImportedLayout {
  active: boolean;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  anchorMinX: number;
  anchorMinY: number;
  anchorMaxX: number;
  anchorMaxY: number;
  anchoredPositionX: number;
  anchoredPositionY: number;
  sizeDeltaX: number;
  sizeDeltaY: number;
  pivotX: number;
  pivotY: number;
}

export interface GiaImportedControl {
  sourceNodeIndex: number;
  parentSourceNodeIndex: number | null;
  childSourceNodeIndices: number[];
  name: string;
  type: ControlType;
  layout: GiaImportedLayout;
  properties: Record<string, unknown>;
}

export interface GiaImportResult {
  projectName: string;
  controls: GiaImportedControl[];
  warnings: string[];
  sourceDocument?: ConverterDocument;
}

const KNOWN_TYPE_COMPONENTS: Array<[string, ControlType]> = [
  ["83", "image"],
  ["74", "text"],
  ["79", "gridScroller"],
  ["80", "presetButton"],
  ["82", "keyHint"],
  ["76", "reference"],
  ["85", "uiAnimation"],
  ["78", "container"],
];

function asObject(value: UgcValue | undefined): GiaObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as GiaObject : null;
}

function asArray(value: UgcValue | undefined): UgcValue[] {
  // The codec can decode a repeated field with one entry as a single object.
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function numberValue(value: UgcValue | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberAt(value: GiaObject | null, key: string, fallback = 0): number {
  return numberValue(value?.[key], fallback);
}

function enumValue<T extends string>(value: UgcValue | undefined, options: readonly T[]): T | null {
  // Protobuf omits zero-valued enums; absence is a valid first option.
  const index = value === undefined ? 0 : value;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < options.length
    ? options[index]
    : null;
}

function cleanNumber(value: number): number {
  if (Math.abs(value) < 0.001) return 0;
  const nearestInteger = Math.round(value);
  if (Math.abs(value - nearestInteger) < 0.001) return nearestInteger;
  return Number(value.toFixed(4));
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeGiaText(value: UgcValue | undefined, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  if (value.startsWith("string:")) return value.slice(7);
  if (value.startsWith("base64:")) return decodeBase64Utf8(value.slice(7)) ?? fallback;
  return value;
}

function packedArgb(value: UgcValue | undefined): ColorRGBA | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const packed = value >>> 0;
  return {
    r: (packed >>> 16) & 0xff,
    g: (packed >>> 8) & 0xff,
    b: packed & 0xff,
    a: ((packed >>> 24) & 0xff) / 255,
  };
}

function metadataOf(node: GiaObject): GiaObject | null {
  return asObject(asObject(node["19"])?.["1"]);
}

function componentsOf(node: GiaObject): GiaObject[] {
  return asArray(metadataOf(node)?.["505"]).map(asObject).filter((value): value is GiaObject => Boolean(value));
}

function componentOf(node: GiaObject, tag: string): GiaObject | null {
  return componentsOf(node).find((component) => component[tag] !== undefined) ?? null;
}

function componentBody(node: GiaObject, tag: string): GiaObject | null {
  const component = componentOf(node, tag);
  if (!component) return null;
  const serialized = asObject(component["503"]);
  return asObject(serialized?.[String(Number(tag) + 1)]) ?? asObject(component[tag]);
}

function controlTypeOf(node: GiaObject): { type: ControlType; known: boolean } {
  for (const [tag, type] of KNOWN_TYPE_COMPONENTS) {
    if (componentOf(node, tag)) return { type, known: true };
  }
  return { type: "container", known: false };
}

function layoutOf(node: GiaObject, deviceIndex: number): GiaImportedLayout {
  const transformComponent = componentOf(node, "11");
  const serialized = asObject(transformComponent?.["503"]);
  const transform = asObject(serialized?.["13"]);
  const layoutEnvelope = asObject(transform?.["12"]);
  const entries = asArray(layoutEnvelope?.["501"]).map(asObject).filter((value): value is GiaObject => Boolean(value));
  const entry = entries.find((candidate) => numberAt(candidate, "501", 0) === deviceIndex) ?? entries[0] ?? null;
  const layout = asObject(entry?.["502"]);
  const scale = asObject(layout?.["501"]);
  const anchorMin = asObject(layout?.["502"]);
  const anchorMax = asObject(layout?.["503"]);
  const anchoredPosition = asObject(layout?.["504"]);
  const sizeDelta = asObject(layout?.["505"]);
  const pivot = asObject(layout?.["506"]);
  const rotation = asObject(layout?.["508"]);
  // GIA 会省略数值为 0 的向量分量。例如 { 502 = 0.5 } 表示 pivot=(0, 0.5)，
  // 只有整个 pivot 字段不存在时才使用编辑器默认中心 (0.5, 0.5)。
  const pivotComponentFallback = pivot ? 0 : 0.5;

  return {
    active: numberAt(layoutEnvelope, "504", 1) !== 0,
    scaleX: cleanNumber(numberAt(scale, "1", 1)),
    scaleY: cleanNumber(numberAt(scale, "2", 1)),
    scaleZ: cleanNumber(numberAt(scale, "3", 1)),
    rotationX: cleanNumber(numberAt(rotation, "1", 0)),
    rotationY: cleanNumber(numberAt(rotation, "2", 0)),
    // GIA stores Euler X/Y/Z in fields 1/2/3; the canvas rotates around Z.
    rotationZ: cleanNumber(numberAt(rotation, "3", 0)),
    anchorMinX: cleanNumber(numberAt(anchorMin, "501", 0)),
    anchorMinY: cleanNumber(numberAt(anchorMin, "502", 0)),
    anchorMaxX: cleanNumber(numberAt(anchorMax, "501", 0)),
    anchorMaxY: cleanNumber(numberAt(anchorMax, "502", 0)),
    anchoredPositionX: cleanNumber(numberAt(anchoredPosition, "501", 0)),
    anchoredPositionY: cleanNumber(numberAt(anchoredPosition, "502", 0)),
    sizeDeltaX: cleanNumber(numberAt(sizeDelta, "501", 0)),
    sizeDeltaY: cleanNumber(numberAt(sizeDelta, "502", 0)),
    pivotX: cleanNumber(numberAt(pivot, "501", pivotComponentFallback)),
    pivotY: cleanNumber(numberAt(pivot, "502", pivotComponentFallback)),
  };
}

function keyboardKeyCode(value: number): string | null {
  if (value >= 1 && value <= 43) return `CraftspersonKey${value}`;
  return null;
}

function controllerKeyCode(value: number): string | null {
  if (value >= 1 && value <= 14) return `CraftspersonKey${value}`;
  const names = ["SprintKey", "JumpKey", "InteractKey", "NormalAttackKey", "CharacterSkill1Key", "CharacterSkill2Key", "CharacterSkill3Key", "CharacterSkill4Key", "MenuConfirmKey", "MenuBackKey"];
  return names[value - 15] ?? null;
}

function propertiesOf(node: GiaObject, type: ControlType): Record<string, unknown> {
  if (type === "reference") {
    const value = numberValue(componentBody(node, "76")?.["501"], Number.NaN);
    return { referencedPrefabIndex: Number.isFinite(value) ? value : null };
  }
  if (type === "uiAnimation") {
    const body = componentBody(node, "85"), animationId = numberValue(body?.["501"], Number.NaN);
    return { animationId: Number.isFinite(animationId) ? animationId : null, playSoundEffect: numberAt(body, "502") !== 0 };
  }
  if (type === "container") {
    const body = componentBody(node, "78");
    return {
      isolateNavigation: numberAt(body, "501", 0) !== 0,
      disableKeyEventPassthrough: numberAt(body, "502", 0) !== 0,
      disableCursorEventPassthrough: numberAt(body, "503", 0) !== 0,
      showCursor: numberAt(body, "504", 0) !== 0,
    };
  }

  if (type === "image") {
    const body = componentBody(node, "83");
    const imageColor = packedArgb(body?.["502"]);
    const imageId = numberValue(body?.["503"], Number.NaN);
    return {
      ...(Number.isFinite(imageId) ? { imageId } : {}),
      ...(imageColor ? { imageColor } : {}),
    };
  }

  if (type === "text") {
    const body = componentBody(node, "74");
    const textNode = asObject(body?.["510"]);
    const fontColor = packedArgb(body?.["504"]);
    const bgColor = packedArgb(body?.["505"]);
    const outlineColor = packedArgb(body?.["507"]);
    const fontSize = numberValue(body?.["512"], Number.NaN);
    const minimumFontSize = numberValue(body?.["513"], Number.NaN);
    return {
      text: decodeGiaText(textNode?.["501"]),
      // Verified against the nine-position text-alignment GIA fixture:
      // 508 = left/middle/right, 509 = top/middle/bottom (0/1/2).
      horizontalAlignment: enumValue(body?.["508"], ["left", "middle", "right"]),
      verticalAlignment: enumValue(body?.["509"], ["top", "middle", "bottom"]),
      ...(Number.isFinite(fontSize) ? { fontSize: cleanNumber(fontSize) } : {}),
      ...(fontColor ? { fontColor } : {}),
      ...(bgColor ? { bgColor } : {}),
      ...(outlineColor ? { outlineColor } : {}),
      // Outline/adaptive-font flags are not these alignment enums. Leave their
      // editor defaults intact until their own serialized fields are verified.
      ...(Number.isFinite(minimumFontSize) ? { minimumFontSize: cleanNumber(minimumFontSize) } : {}),
    };
  }

  if (type === "presetButton") {
    const body = componentBody(node, "80");
    const clickAudioId = numberValue(body?.["506"], Number.NaN);
    return {
      interactable: numberAt(body, "505", 0) !== 0,
      ...(Number.isFinite(clickAudioId) ? { clickAudioId } : {}),
      raycastTarget: numberAt(body, "507", 0) !== 0,
    };
  }

  if (type === "keyHint") {
    const body = componentBody(node, "82");
    return {
      keyboardKeyCode: keyboardKeyCode(numberAt(body, "501", 0)),
      controllerKeyCode: controllerKeyCode(numberAt(body, "502", 0)),
    };
  }

  if (type === "gridScroller") {
    const body = componentBody(node, "79");
    const itemCount = numberValue(body?.["511"], Number.NaN);
    const itemPrefabIndex = numberValue(body?.["506"], Number.NaN);
    return {
      ...(Number.isFinite(itemCount) ? { itemCount } : {}),
      ...(Number.isFinite(itemPrefabIndex) ? { itemPrefabIndex } : {}),
      raycastTarget: numberAt(body, "507", 0) !== 0,
      showScrollBar: numberAt(body, "508", 0) !== 0,
      interactable: numberAt(body, "509", 0) !== 0,
    };
  }

  return {};
}

function sourceNodeIndexOf(node: GiaObject): number | null {
  const identity = asObject(node["1"]);
  const index = numberValue(identity?.["4"], Number.NaN);
  return Number.isFinite(index) ? index : null;
}

function childrenOf(node: GiaObject): number[] {
  return asArray(node["2"]).map(asObject).map((reference) => numberValue(reference?.["4"], Number.NaN)).filter(Number.isFinite);
}

function orderControls(controls: GiaImportedControl[]): GiaImportedControl[] {
  const byId = new Map(controls.map((control) => [control.sourceNodeIndex, control]));
  const visited = new Set<number>();
  const result: GiaImportedControl[] = [];
  const visit = (control: GiaImportedControl) => {
    if (visited.has(control.sourceNodeIndex)) return;
    visited.add(control.sourceNodeIndex);
    result.push(control);
    // GIA 按由底到顶保存 sibling；编辑器层级树约定越靠上越先显示、画布层级也越高。
    control.childSourceNodeIndices.slice().reverse().forEach((childId) => {
      const child = byId.get(childId);
      if (child) visit(child);
    });
  };
  controls.filter((control) => control.parentSourceNodeIndex === null || !byId.has(control.parentSourceNodeIndex)).forEach(visit);
  controls.forEach(visit);
  return result;
}

/** Decode a GIA file and map only fields observed in the current client-UI schema. */
export function importGiaControls(input: ArrayBuffer, deviceIndex = 0): GiaImportResult {
  const document = decode(input, { type: "gia" });
  return { ...readGiaControls(document.json, deviceIndex), sourceDocument: document };
}

/** Templates retain every device layout, decoding the binary only once. */
export function importGiaControlTemplate(input: ArrayBuffer): GiaImportResult[] {
  const document = decode(input, { type: "gia" });
  return [0, 1, 2, 3].map(device => readGiaControls(document.json, device));
}

export function readGiaControls(json: UgcValue, deviceIndex: number): GiaImportResult {
  const root = asObject(json);
  if (!root) throw new Error("GIA 根数据不是对象");
  const rawNodes = asArray(root["2"]).map(asObject).filter((value): value is GiaObject => Boolean(value));
  // A template's primary entry is its root control; a UI project's primary
  // entry is just a wrapper. Only include entries with a real RectTransform.
  const primary = asObject(root["1"]);
  if (primary && componentOf(primary, "11") && !componentOf(primary, "72") && primary["5"] !== 21) rawNodes.unshift(primary);
  const seen = new Set<number>();
  const warnings: string[] = [];
  const controls: GiaImportedControl[] = [];

  rawNodes.forEach((node) => {
    const sourceNodeIndex = sourceNodeIndexOf(node);
    if (sourceNodeIndex === null || seen.has(sourceNodeIndex)) return;
    seen.add(sourceNodeIndex);
    const metadata = metadataOf(node);
    const rawParentIndex = numberValue(metadata?.["504"], Number.NaN);
    const detected = controlTypeOf(node);
    const nameComponent = componentOf(node, "12");
    const componentName = decodeGiaText(asObject(nameComponent?.["12"])?.["501"]);
    const name = decodeGiaText(node["3"], componentName || `Control_${sourceNodeIndex}`);
    if (!detected.known) warnings.push(`${name}：未识别具体控件组件，按容器保留层级`);
    controls.push({
      sourceNodeIndex,
      parentSourceNodeIndex: Number.isFinite(rawParentIndex) ? rawParentIndex : null,
      childSourceNodeIndices: childrenOf(node),
      name,
      type: detected.type,
      layout: layoutOf(node, deviceIndex),
      properties: propertiesOf(node, detected.type),
    });
  });

  if (controls.length === 0) throw new Error("GIA 中没有找到客户端 UI 控件");
  const unknownTextAlignments = controls.filter((control) => control.type === "text"
    && (control.properties.horizontalAlignment === null || control.properties.verticalAlignment === null));
  if (unknownTextAlignments.length) {
    warnings.push(`文本对齐未识别（${unknownTextAlignments.map((control) => `${control.name} #${control.sourceNodeIndex}`).join("、")}）：未知的水平/垂直对齐值已标为未设置，请在属性面板核对`);
  }
  const project = asObject(root["1"]);
  return {
    projectName: decodeGiaText(project?.["3"], "Imported GIA UI"),
    controls: orderControls(controls),
    warnings,
  };
}
