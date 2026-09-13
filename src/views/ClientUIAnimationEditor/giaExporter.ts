import { decode, encode, type ConverterDocument, type UgcValue } from "genshin-impact-ugc-file-converter-web";
import { controlRegistry, createControlProperties } from "./controlRegistry";
import { readGiaControls } from "./giaImporter";
import type { ColorRGBA, ControlType, UINode } from "./types";
import { toNativeExportNode } from "./primitiveControl";

type Obj = Record<string, UgcValue>;
export interface GiaExportSource { document: ConverterDocument; baseline?: UINode[]; deviceIndex: number }
export interface GiaExportOptions { name: string; uiIndex: number; deviceIndex: number; nodes: UINode[]; source?: GiaExportSource | null }
export interface GiaExportResult { bytes: Uint8Array; document: ConverterDocument; controlCount: number }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const obj = (value: UgcValue | undefined): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const list = (value: UgcValue | undefined): UgcValue[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const identity = (id: number): Obj => ({ "2": 1, "3": 8, "4": id });
const metadata = (node: Obj) => obj(obj(node["19"])["1"]);
const components = (node: Obj) => list(metadata(node)["505"]).map(obj);
const component = (node: Obj, tag: number) => components(node).find(c => String(tag) in c);
function body(node: Obj, tag: number): Obj {
  const c = component(node, tag);
  if (!c) throw new Error(`控件缺少组件 ${tag}，无法安全写回`);
  const envelope = obj(c["503"]); c["503"] = envelope;
  const result = obj(envelope[String(tag + 1)]); envelope[String(tag + 1)] = result;
  return result;
}
const TYPE_TAGS: Partial<Record<ControlType, number>> = { container: 78, image: 83, text: 74, presetButton: 80, gridScroller: 79, keyHint: 82, reference: 76, uiAnimation: 85 };
const layoutFields = {
  scaleX: ["501", "1"], scaleY: ["501", "2"], scaleZ: ["501", "3"],
  anchorMinX: ["502", "501"], anchorMinY: ["502", "502"], anchorMaxX: ["503", "501"], anchorMaxY: ["503", "502"],
  anchorOffsetX: ["504", "501"], anchorOffsetY: ["504", "502"], sizeDeltaX: ["505", "501"], sizeDeltaY: ["505", "502"],
  pivotX: ["506", "501"], pivotY: ["506", "502"], rotationX: ["508", "1"], rotationY: ["508", "2"], rotation: ["508", "3"],
} as const;

function nativeComponent(tag: number, id: number, value: Obj = {}): Obj {
  const ids: Record<number, [number, number, number]> = {
    73: [63, 83, 65], 74: [64, 84, 66], 77: [67, 90, 69], 78: [68, 91, 70],
    79: [69, 92, 71], 80: [70, 93, 72], 82: [72, 95, 74], 83: [73, 96, 75], 84: [74, 97, 76], 76: [66, 89, 68], 85: [75, 98, 77],
  };
  const [first, type, second] = ids[tag];
  return { [tag]: "base64:", "501": first, "502": type,
    "503": { [tag + 1]: value, "501": second, "502": type, "503": 1, "504": identity(id) } };
}
function transformComponent(id: number): Obj {
  return { "11": { "12": "base64:", "501": 2 }, "501": 1, "502": 12,
    "503": { "13": { "12": { "501": [0, 1, 2, 3].map(device => ({ "501": device, "502": {} })), "502": 25, "504": 1 }, "501": 2 },
      "501": 4, "502": 12, "503": 1, "504": identity(id) } };
}
function createNativeControl(node: UINode, id: number): Obj {
  const tag = TYPE_TAGS[node.type];
  if (!tag) throw new Error(`「${node.name}」：${controlRegistry[node.type].label} 尚无已验证的 GIA 写入结构，请提供该类型的原生导出样例`);
  const cs: Obj[] = [
    { "12": { "501": `string:${node.name}` }, "501": 2, "502": 15 },
    { "14": { "17": "base64:", "501": 7 }, "501": 4, "502": 86,
      "503": { "14": { "17": {}, "501": 7 }, "501": 5, "502": 86, "503": 1, "504": identity(id) } },
    transformComponent(id), nativeComponent(73, id), nativeComponent(tag, id),
  ];
  if (node.type === "image") cs.push(nativeComponent(84, id));
  cs.push(nativeComponent(77, id));
  return { "1": identity(id), "3": `string:${node.name}`, "5": 15,
    "19": { "1": { "501": id, "502": { "11": { "501": id }, "501": 1, "502": 5 }, "505": cs } } };
}
function createNativeUI(id: number, rootId: number, name: string, index: number): Obj {
  const transform = transformComponent(id);
  const envelope = obj(obj(obj(transform["503"])["13"])["12"]);
  envelope["502"] = 24;
  envelope["501"] = [0, 1, 2, 3].map(device => ({ "501": device, "502": {
    "501": { "1": 1, "2": 1, "3": 1 }, "502": {}, "503": { "501": 1, "502": 1 }, "504": {}, "505": {}, "506": { "501": .5, "502": .5 }, "508": {},
  } }));
  return { "1": identity(id), "3": `string:${name}`, "5": 21, "19": { "1": {
    "501": id, "502": [{ "11": { "501": id }, "501": 1, "502": 5 }, { "12": { "501": index }, "501": 2, "502": 6 }, { "14": { "501": packIndices([rootId]) }, "501": 4, "502": 4 }],
    "505": [{ "12": { "501": `string:${name}` }, "501": 2, "502": 15 },
      { "14": { "15": "base64:", "501": 5 }, "501": 4, "502": 23,
        "503": { "14": { "15": "base64:", "501": 5 }, "501": 5, "502": 23, "503": 1, "504": identity(id) } }, transform,
      { "72": "base64:", "501": 62, "502": 82, "503": { "73": { "501": rootId }, "501": 64, "502": 82, "503": 1, "504": identity(id) } }],
  } } };
}
function packIndices(ids: number[]): string {
  const bytes: number[] = [];
  for (let id of ids) { do { const low = id % 128; id = Math.floor(id / 128); bytes.push(low | (id ? 128 : 0)); } while (id); }
  return `base64:${btoa(bytes.map(byte => String.fromCharCode(byte)).join(""))}`;
}
function setHierarchy(raw: Obj, parentId: number | null, childIds: number[]) {
  const meta = metadata(raw);
  if (parentId === null) delete meta["504"]; else meta["504"] = parentId;
  if (childIds.length) { raw["2"] = childIds.map(identity); meta["503"] = packIndices(childIds); }
  else { delete raw["2"]; delete meta["503"]; }
}
/** Only rewrite typed control identities, never arbitrary numbers such as image/template IDs. */
function remapControlIdentities(value: UgcValue, ids: Map<number, number>) {
  if (Array.isArray(value)) { value.forEach(item => remapControlIdentities(item, ids)); return; }
  if (!value || typeof value !== "object") return;
  const raw = value as Obj;
  if (raw["2"] === 1 && raw["3"] === 8 && typeof raw["4"] === "number" && ids.has(raw["4"])) raw["4"] = ids.get(raw["4"])!;
  Object.values(raw).forEach(item => remapControlIdentities(item, ids));
}
function reindexNativeControl(raw: Obj, id: number, ids: Map<number, number>) {
  remapControlIdentities(raw, ids);
  raw["1"] = { ...obj(raw["1"]), ...identity(id) };
  const meta = metadata(raw);
  meta["501"] = id;
  for (const attribute of list(meta["502"]).map(obj)) {
    if ("11" in attribute) attribute["11"] = { ...obj(attribute["11"]), "501": id };
  }
}
function writeLayout(raw: Obj, node: UINode, baseline: UINode | undefined, deviceIndex: number) {
  const c = component(raw, 11);
  if (!c) throw new Error(`「${node.name}」缺少原始布局，无法导出`);
  const transform = obj(obj(c["503"])["13"]), envelope = obj(transform["12"]);
  transform["12"] = envelope;
  if (!baseline || node.active !== baseline.active) envelope["504"] = node.active ? 1 : 0;
  const entries = list(envelope["501"]).map(obj);
  const targets = baseline ? [deviceIndex] : [0, 1, 2, 3];
  for (const device of targets) {
    let entry = entries.find(item => Number(item["501"] ?? 0) === device);
    const changes = Object.keys(layoutFields).filter(key => !baseline || node[key as keyof typeof layoutFields] !== baseline[key as keyof typeof layoutFields]);
    if (!changes.length) continue;
    if (!entry) { entry = { "501": device, "502": clone(obj(entries[0]?.["502"])) }; entries.push(entry); }
    const layout = obj(entry["502"]); entry["502"] = layout;
    for (const key of changes as Array<keyof typeof layoutFields>) {
      const value = node[key];
      if (!Number.isFinite(value)) throw new Error(`「${node.name}」的 ${key} 不是有效数字`);
      const [vectorKey, axis] = layoutFields[key], vector = obj(layout[vectorKey]);
      layout[vectorKey] = vector; vector[axis] = value;
    }
  }
  envelope["501"] = entries;
}
function packedColor(value: unknown): number {
  const c = value as ColorRGBA;
  if (!c || ![c.r, c.g, c.b, c.a].every(Number.isFinite) || [c.r, c.g, c.b].some(v => v < 0 || v > 255) || c.a < 0 || c.a > 1) throw new Error("颜色必须是有效的 RGBA 值");
  return (Math.round(c.a * 255) << 24) | (Math.round(c.r) << 16) | (Math.round(c.g) << 8) | Math.round(c.b);
}
type PropertyWriter = (raw: Obj, value: unknown) => void;
const scalar = (tag: number, field: string, convert: (value: unknown) => UgcValue = value => value as UgcValue): PropertyWriter => (raw, value) => {
  const b = body(raw, tag); if (value === null || value === undefined) delete b[field]; else b[field] = convert(value);
};
const flag = (value: unknown) => value ? 1 : 0;
const enumeration = (values: string[]) => (value: unknown) => {
  const index = values.indexOf(String(value)); if (index < 0) throw new Error(`未知枚举值 ${String(value)}`); return index;
};
const PROPERTY_WRITERS: Partial<Record<ControlType, Record<string, PropertyWriter>>> = {
  reference: { referencedPrefabIndex: scalar(76, "501") },
  uiAnimation: { animationId: scalar(85, "501"), playSoundEffect: scalar(85, "502", flag) },
  container: { isolateNavigation: scalar(78, "501", flag), disableKeyEventPassthrough: scalar(78, "502", flag), disableCursorEventPassthrough: scalar(78, "503", flag), showCursor: scalar(78, "504", flag) },
  image: { imageId: scalar(83, "503"), imageColor: scalar(83, "502", packedColor) },
  text: { text: (raw, value) => { const b = body(raw, 74), text = obj(b["510"]); b["510"] = text; text["501"] = `string:${String(value ?? "")}`; },
    fontSize: scalar(74, "512"), minimumFontSize: scalar(74, "513"), fontColor: scalar(74, "504", packedColor), bgColor: scalar(74, "505", packedColor), outlineColor: scalar(74, "507", packedColor),
    horizontalAlignment: scalar(74, "508", enumeration(["left", "middle", "right"])), verticalAlignment: scalar(74, "509", enumeration(["top", "middle", "bottom"])) },
  presetButton: { interactable: scalar(80, "505", flag), clickAudioId: scalar(80, "506"), raycastTarget: scalar(80, "507", flag) },
  gridScroller: { itemCount: scalar(79, "511"), itemPrefabIndex: scalar(79, "506"), raycastTarget: scalar(79, "507", flag), showScrollBar: scalar(79, "508", flag), interactable: scalar(79, "509", flag) },
  keyHint: { keyboardKeyCode: scalar(82, "501", value => {
    if (value === "None") return 0;
    const match = /^CraftspersonKey(\d+)$/.exec(String(value)); if (!match || Number(match[1]) < 1 || Number(match[1]) > 43) throw new Error(`尚未验证此键鼠按键的 GIA 编码：${String(value)}`); return Number(match[1]);
  }), controllerKeyCode: scalar(82, "502", value => {
    if (value === "None") return 0;
    const keys = [...Array.from({ length: 14 }, (_, i) => `CraftspersonKey${i + 1}`), "SprintKey", "JumpKey", "InteractKey", "NormalAttackKey", "CharacterSkill1Key", "CharacterSkill2Key", "CharacterSkill3Key", "CharacterSkill4Key", "MenuConfirmKey", "MenuBackKey"];
    const index = keys.indexOf(String(value)); if (index < 0) throw new Error(`未知手柄按键 ${String(value)}`); return index + 1;
  }) },
};
function writeProperties(raw: Obj, node: UINode, baseline?: UINode) {
  const defaults = createControlProperties(node.type) as unknown as Record<string, unknown>;
  const previous = (baseline?.properties ?? defaults) as unknown as Record<string, unknown>;
  const writers = PROPERTY_WRITERS[node.type] ?? {};
  for (const [key, value] of Object.entries(node.properties)) {
    if (baseline && equal(value, previous[key])) continue;
    const writer = writers[key];
    if (writer) { try { writer(raw, value); } catch (error) { throw new Error(`「${node.name}」${key}：${(error as Error).message}`); } }
    else if (!equal(value, previous[key])) throw new Error(`「${node.name}」的「${controlRegistry[node.type].fields.find(field => field.key === key)?.label ?? key}」尚未验证 GIA 字段，已停止导出以避免数据丢失`);
  }
  if (node.canControllerFocus !== (baseline?.canControllerFocus ?? false) || node.visible !== (baseline?.visible ?? true)) {
    throw new Error(`「${node.name}」的可见性或手柄聚焦尚未验证 GIA 字段，无法保持数据一致；请提供相应原生导出样例`);
  }
}

/** Retain original wire types; known RectTransform components always use float32. */
function prepareEncoding(document: ConverterDocument): void {
  const types = new Map<string, { multiple: boolean; type: string }>();
  for (const line of document.dtype_csv.split(/\r?\n/)) {
    const [path, multiple, type] = line.split(","); if (path && type) types.set(path, { multiple: multiple === "*", type });
  }
  const records = new Map<string, { owners: Obj[]; key: string; values: UgcValue[]; multiple: boolean }>();
  function collect(owner: Obj, key: string, path: string) {
    const value = owner[key], values = Array.isArray(value) ? value : [value];
    const record = records.get(path) ?? { owners: [], key, values: [], multiple: false };
    record.owners.push(owner); record.values.push(...values); record.multiple ||= Array.isArray(value); records.set(path, record);
    for (const child of values) if (child && typeof child === "object" && !Array.isArray(child)) for (const childKey of Object.keys(child)) collect(child as Obj, childKey, `${path}/${childKey}`);
  }
  for (const key of Object.keys(obj(document.json))) collect(document.json as Obj, key, key);
  for (const [path, record] of records) {
    const old = types.get(path);
    let type = old?.type;
    if (record.values.some(value => value && typeof value === "object")) type = "object";
    else if (record.values.some(value => typeof value === "number")) {
      if (/\/503\/13\/12\/501\/502\/(501|502|503|504|505|506|508)\/(1|2|3|501|502)$/.test(path)) type = "float32";
      else if (!["int", "int32", "int64", "float32"].includes(type ?? "")) type = "int";
      if (type !== "float32" && record.values.some(value => typeof value === "number" && !Number.isSafeInteger(value))) throw new Error(`GIA 整数字段 ${path} 包含小数或越界值，不能无损写入`);
    } else if (record.values.some(value => typeof value === "string" && value.startsWith("string:"))) type = "string";
    else if (!type || type === "object") type = "data";
    const multiple = record.multiple || old?.multiple === true;
    for (const owner of record.owners) {
      const normalize = (value: UgcValue): UgcValue => {
        if (type === "object" && value === "base64:") return {};
        if (type === "string" && typeof value === "string" && value.startsWith("base64:")) {
          return `string:${new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(value.slice(7)), char => char.charCodeAt(0)))}`;
        }
        return value;
      };
      const value = owner[record.key]; owner[record.key] = multiple ? list(value).map(normalize) : normalize(value);
    }
    types.set(path, { type: type ?? "data", multiple });
  }
  document.dtype_csv = [...types].map(([path, entry]) => `${path},${entry.multiple ? "*" : ""},${entry.type}`).join("\n");
}

export function normalizeGiaExportSource(value: unknown): GiaExportSource | null {
  if (value === undefined || value === null) return null;
  const source = value as GiaExportSource;
  if (!source.document || source.document.filetype !== "gia" || !source.document.json || typeof source.document.dtype_csv !== "string"
    || !Number.isInteger(source.deviceIndex) || source.deviceIndex < 0 || source.deviceIndex > 3
    || source.baseline !== undefined && !Array.isArray(source.baseline)) throw new Error("原始 GIA 数据无效");
  return clone(source);
}
export function originalGiaUIIndex(source: GiaExportSource | null): number {
  const primary = obj(obj(source?.document.json)["1"]);
  const value = obj(list(metadata(primary)["502"]).map(obj).find(item => "12" in item)?.["12"])["501"];
  return typeof value === "number" ? value : 1;
}

/** Match the editor's initial layout rebase without changing the live document. */
export function createGiaExportBaseline(nodes: UINode[], canvasWidth: number, canvasHeight: number): UINode[] {
  const result = clone(nodes), byId = new Map(result.map(node => [node.id, node]));
  const round = (value: number) => Number(value.toFixed(2));
  for (const node of result) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const width = parent?.width ?? canvasWidth, height = parent?.height ?? canvasHeight;
    node.anchorOffsetX = round(node.x - ((1 - node.pivotX) * node.anchorMinX + node.pivotX * node.anchorMaxX) * width);
    node.anchorOffsetY = round(node.y - ((1 - node.pivotY) * node.anchorMinY + node.pivotY * node.anchorMaxY) * height);
    node.sizeDeltaX = round(node.width - (node.anchorMaxX - node.anchorMinX) * width);
    node.sizeDeltaY = round(node.height - (node.anchorMaxY - node.anchorMinY) * height);
  }
  return result;
}

/** Export setup nodes only. Never bake the current animation preview into a native UI. */
export function exportGiaUI(options: GiaExportOptions): GiaExportResult {
  if (!Number.isSafeInteger(options.uiIndex) || options.uiIndex < 0 || options.uiIndex > 2147483647) throw new Error("客户端 UI 索引必须是 0～2147483647 的整数");
  if (!options.nodes.length) throw new Error("控件树为空");
  const nodes = clone(options.nodes).map(toNativeExportNode), source = normalizeGiaExportSource(options.source);
  if (source?.baseline) source.baseline = source.baseline.map(toNativeExportNode);
  if (!source && nodes.some(node => /^gia_node_\d+$/.test(node.id))) throw new Error("此工程未保留原始 GIA，无法保证未识别参数一致。请先补充原始 GIA 文件，再导出当前控件树。");
  const map = new Map(nodes.map(node => [node.id, node]));
  if (map.size !== nodes.length || nodes.some(node => node.parentId !== null && !map.has(node.parentId))) throw new Error("控件树有重复 ID 或缺失父控件");
  const roots = nodes.filter(node => !node.parentId);
  if (roots.length !== 1 || roots[0].type !== "container") throw new Error("客户端 UI 必须有且仅有一个根容器");
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(node: UINode) { if (visiting.has(node.id)) throw new Error("控件层级存在循环"); if (visited.has(node.id)) return; visiting.add(node.id); if (node.parentId) visit(map.get(node.parentId)!); visiting.delete(node.id); visited.add(node.id); }
  nodes.forEach(visit);
  const original = obj(source?.document.json), originalPrimary = obj(original["1"]);
  const rawNodes = [...list(original["2"]).map(obj), ...(originalPrimary["5"] === 70 ? [originalPrimary] : [])];
  const rawMap = new Map(rawNodes.map(raw => [Number(obj(raw["1"])["4"]), raw]));
  const baseline = new Map((source?.baseline ?? []).map(node => [node.id, node]));
  if (source && !source.baseline) throw new Error("缺少原始 GIA 的编辑基准，请重新导入原始 GIA");
  const oldIds = new Set((source?.baseline ?? []).map(node => Number(/^gia_node_(\d+)$/.exec(node.id)?.[1])));
  const dependencies = clone(list(original["2"]).map(obj).filter(raw => !oldIds.has(Number(obj(raw["1"])["4"]))));
  // Reserve a contiguous block for every control plus the UI wrapper. External
  // dependencies retain their identities, so move the whole block past a collision.
  let nextId = 1073741825;
  const reserved = dependencies.map(raw => Number(obj(raw["1"])["4"])).filter(Number.isFinite).sort((a, b) => a - b);
  for (const id of reserved) if (id >= nextId && id <= nextId + nodes.length) nextId = id + 1;
  if (!Number.isSafeInteger(nextId + nodes.length) || nextId + nodes.length > 2147483647) throw new Error("没有足够的连续控件 ID 可用于导出");
  const ids = new Map(nodes.map(node => [node.id, nextId++] as const));
  const primaryId = nextId;
  const remappedIds = new Map<number, number>();
  for (const node of nodes) {
    const old = /^gia_node_(\d+)$/.exec(node.id);
    if (old && rawMap.has(Number(old[1]))) remappedIds.set(Number(old[1]), ids.get(node.id)!);
  }
  if (originalPrimary["5"] === 21) remappedIds.set(Number(obj(originalPrimary["1"])["4"]), primaryId);
  const errors: string[] = [], output: Obj[] = [];
  for (const node of nodes) {
    try {
      const id = ids.get(node.id)!, oldId = /^gia_node_(\d+)$/.exec(node.id), old = oldId ? rawMap.get(Number(oldId[1])) : undefined, before = baseline.get(node.id);
      if (old && !before) throw new Error(`「${node.name}」缺少原始编辑基准`);
      if (before && node.type !== before.type) throw new Error(`「${node.name}」已更改控件类型，无法保留原始组件`);
      const raw = old ? clone(old) : createNativeControl(node, id);
      if (old) reindexNativeControl(raw, id, remappedIds);
      raw["5"] = 15;
      if (!before || node.name !== before.name) { raw["3"] = `string:${node.name}`; const name = component(raw, 12); if (name) name["12"] = { ...obj(name["12"]), "501": `string:${node.name}` }; }
      const children = nodes.filter(child => child.parentId === node.id).slice().reverse().map(child => ids.get(child.id)!);
      setHierarchy(raw, node.parentId ? ids.get(node.parentId)! : null, children);
      writeLayout(raw, node, before, options.deviceIndex); writeProperties(raw, node, before); output.push(raw);
    } catch (error) { errors.push((error as Error).message); }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const rootId = ids.get(roots[0].id)!;
  const primary = originalPrimary["5"] === 21 ? clone(originalPrimary) : createNativeUI(primaryId, rootId, options.name, options.uiIndex);
  if (originalPrimary["5"] === 21) reindexNativeControl(primary, primaryId, remappedIds);
  primary["3"] = `string:${options.name}`;
  const nameComponent = component(primary, 12); if (nameComponent) nameComponent["12"] = { ...obj(nameComponent["12"]), "501": `string:${options.name}` };
  body(primary, 72)["501"] = rootId;
  const attributes = list(metadata(primary)["502"]).map(obj), indexAttribute = attributes.find(item => "12" in item);
  if (indexAttribute) indexAttribute["12"] = { ...obj(indexAttribute["12"]), "501": options.uiIndex };
  metadata(primary)["502"] = attributes;
  const rootAttribute = attributes.find(item => "14" in item);
  if (rootAttribute) rootAttribute["14"] = { ...obj(rootAttribute["14"]), "501": packIndices([rootId]) };
  primary["2"] = [rootId, ...nodes.filter(node => node.parentId === roots[0].id).slice().reverse().map(node => ids.get(node.id)!)].map(identity);
  dependencies.forEach(raw => remapControlIdentities(raw, remappedIds));
  const document: ConverterDocument = source ? clone(source.document) : { filetype: "gia", dirtype: "Unknown", info: { "1": 1, "2": 806, "3": 3, "4": 1657 }, json: {}, dtype_csv: "" };
  document.json = { ...original, "1": primary, "2": [...output, ...dependencies] };
  if (!source) (document.json as Obj)["5"] = "string:7.0.54";
  prepareEncoding(document);
  const bytes = encode(document, { type: "gia" });
  // Decode the actual bytes and verify topology and mapped values, not just JSON.
  const decoded = decode(bytes, { type: "gia" });
  const imported = readGiaControls(decoded.json, options.deviceIndex);
  const resultMap = new Map(imported.controls.map(control => [control.sourceNodeIndex, control]));
  for (const node of nodes) {
    const actual = resultMap.get(ids.get(node.id)!);
    if (!actual || actual.parentSourceNodeIndex !== (node.parentId ? ids.get(node.parentId)! : null)) throw new Error(`导出校验失败：${node.name} 的父子关系不一致`);
    if (actual.name !== node.name) throw new Error(`导出校验失败：${node.name} 的名称不一致`);
    const expectedChildren = nodes.filter(child => child.parentId === node.id).slice().reverse().map(child => ids.get(child.id)!);
    if (!equal(actual.childSourceNodeIndices, expectedChildren)) throw new Error(`导出校验失败：${node.name} 的子控件顺序不一致`);
    const before = baseline.get(node.id);
    if ((!before || node.active !== before.active) && actual.layout.active !== node.active) throw new Error(`导出校验失败：${node.name} 的激活状态不一致`);
    for (const key of Object.keys(layoutFields) as Array<keyof typeof layoutFields>) {
      if (before && node[key] === before[key]) continue;
      const target = ({ anchorOffsetX: "anchoredPositionX", anchorOffsetY: "anchoredPositionY", rotation: "rotationZ" } as Record<string, string>)[key] ?? key;
      const value = actual.layout[target as keyof typeof actual.layout];
      if (typeof value !== "number" || Math.abs(value - node[key]) > Math.max(.001, Math.abs(node[key]) * 1e-6)) throw new Error(`导出校验失败：${node.name} 的 ${key} 不一致`);
    }
    for (const key of Object.keys(PROPERTY_WRITERS[node.type] ?? {})) {
      const expected = (node.properties as unknown as Record<string, unknown>)[key], actualValue = actual.properties[key];
      if (before && equal(expected, (before.properties as unknown as Record<string, unknown>)[key])) continue;
      if (expected == null && actualValue == null || node.type === "keyHint" && expected === "None" && actualValue === null) continue;
      if (expected && typeof expected === "object" && "a" in expected) {
        const c = expected as ColorRGBA;
        if (equal(actualValue, { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: Math.round(c.a * 255) / 255 })) continue;
      } else if (equal(expected, actualValue)) continue;
      throw new Error(`导出校验失败：${node.name} 的 ${key} 不能在 GIA 中保持一致`);
    }
  }
  return { bytes, document, controlCount: nodes.length };
}
