import { controlRegistry } from "./controlRegistry";
import { importGiaControlTemplate, type GiaImportedControl } from "./giaImporter";

/** Embedded in the editor document, so references survive JSON export/reopen. */
export interface ControlTemplateAsset {
  id: string;
  index: number;
  name: string;
  sourceName: string;
  devices: GiaImportedControl[][];
  warnings: string[];
}

export function nextTemplateIndex(assets: ControlTemplateAsset[]): number {
  const used = new Set(assets.map(asset => asset.index));
  let index = 1;
  while (used.has(index)) index++;
  return index;
}

export function templateIndexError(index: number, assets: ControlTemplateAsset[], exceptId?: string): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 2147483647) return "索引必须是 0～2147483647 的整数";
  return assets.some(asset => asset.id !== exceptId && asset.index === index) ? `索引 ${index} 已被其他模板使用` : "";
}

export function readControlTemplate(input: ArrayBuffer, sourceName: string, index: number): ControlTemplateAsset {
  const results = importGiaControlTemplate(input);
  const asset: ControlTemplateAsset = {
    id: `template-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    index, name: results[0].projectName || sourceName.replace(/\.gia$/i, ""), sourceName,
    devices: results.map(result => result.controls), warnings: [...new Set(results.flatMap(result => result.warnings))],
  };
  return normalizeControlTemplates([asset])[0];
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Reject malformed libraries before changing the currently open document. */
export function normalizeControlTemplates(value: unknown): ControlTemplateAsset[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("控件模板库格式无效");
  const result: ControlTemplateAsset[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.id !== "string" || !item.id || result.some(asset => asset.id === item.id)
      || typeof item.name !== "string" || !item.name.trim() || typeof item.index !== "number"
      || !Array.isArray(item.devices) || item.devices.length !== 4) throw new Error("控件模板数据无效");
    const error = templateIndexError(item.index, result);
    if (error) throw new Error(error);
    for (const controls of item.devices) {
      if (!Array.isArray(controls) || !controls.length) throw new Error(`模板「${item.name}」没有控件`);
      const ids = new Set<number>();
      for (const control of controls) {
        if (!record(control) || !Number.isSafeInteger(control.sourceNodeIndex) || ids.has(control.sourceNodeIndex as number)
          || (control.parentSourceNodeIndex !== null && !Number.isSafeInteger(control.parentSourceNodeIndex))
          || typeof control.name !== "string" || typeof control.type !== "string"
          || !Object.prototype.hasOwnProperty.call(controlRegistry, control.type)
          || !record(control.properties) || !record(control.layout)
          || !Array.isArray(control.childSourceNodeIndices) || !control.childSourceNodeIndices.every(Number.isSafeInteger)) {
          throw new Error(`模板「${item.name}」的控件数据无效`);
        }
        const layout = control.layout;
        if (typeof layout.active !== "boolean" || ["scaleX", "scaleY", "scaleZ", "rotationX", "rotationY", "rotationZ",
          "anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY", "anchoredPositionX", "anchoredPositionY", "sizeDeltaX", "sizeDeltaY", "pivotX", "pivotY"]
          .some(key => typeof layout[key] !== "number" || !Number.isFinite(layout[key]))) throw new Error(`模板「${item.name}」的布局数据无效`);
        ids.add(control.sourceNodeIndex as number);
      }
      const byId = new Map<number, GiaImportedControl>((controls as GiaImportedControl[]).map(control => [control.sourceNodeIndex, control]));
      const visited = new Set<number>();
      const visiting = new Set<number>();
      function visit(control: GiaImportedControl) {
        if (visiting.has(control.sourceNodeIndex)) throw new Error(`模板「${item.name}」的控件层级存在循环`);
        if (visited.has(control.sourceNodeIndex)) return;
        visiting.add(control.sourceNodeIndex);
        const parent = control.parentSourceNodeIndex === null ? undefined : byId.get(control.parentSourceNodeIndex);
        if (parent) visit(parent);
        visiting.delete(control.sourceNodeIndex);
        visited.add(control.sourceNodeIndex);
      }
      byId.forEach(visit);
    }
    result.push({ id: item.id, index: item.index, name: item.name.trim(), sourceName: typeof item.sourceName === "string" ? item.sourceName : "",
      devices: JSON.parse(JSON.stringify(item.devices)), warnings: Array.isArray(item.warnings) ? item.warnings.filter((warning): warning is string => typeof warning === "string") : [] });
  }
  return result;
}

interface Matrix { a: number; b: number; c: number; d: number }
export interface TemplateSceneNode {
  control: GiaImportedControl;
  width: number; height: number; x: number; y: number;
  matrix: Matrix; visible: boolean;
}
export interface TemplateScene { nodes: TemplateSceneNode[]; width: number; height: number; minX: number; maxY: number }

/** Y-up transforms, matching the editor canvas; templates are placed at their own origin. */
export function buildTemplateScene(asset: ControlTemplateAsset, deviceIndex = 0): TemplateScene {
  const controls = asset.devices[deviceIndex] ?? asset.devices[0];
  const byId = new Map(controls.map(control => [control.sourceNodeIndex, control]));
  const resolved = new Map<number, TemplateSceneNode>();
  function resolve(control: GiaImportedControl): TemplateSceneNode {
    const cached = resolved.get(control.sourceNodeIndex);
    if (cached) return cached;
    const l = control.layout;
    const parentControl = control.parentSourceNodeIndex === null ? undefined : byId.get(control.parentSourceNodeIndex);
    const parent = parentControl ? resolve(parentControl) : undefined;
    const parentWidth = parent?.width ?? 1600, parentHeight = parent?.height ?? 900;
    const width = Math.max(0, parentWidth * (l.anchorMaxX - l.anchorMinX) + l.sizeDeltaX);
    const height = Math.max(0, parentHeight * (l.anchorMaxY - l.anchorMinY) + l.sizeDeltaY);
    const angle = l.rotationZ * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const local = { a: cos * l.scaleX, b: sin * l.scaleX, c: -sin * l.scaleY, d: cos * l.scaleY };
    let x = 0, y = 0, matrix = local;
    if (parent) {
      const px = parentWidth * (l.anchorMinX + (l.anchorMaxX - l.anchorMinX) * l.pivotX - parent.control.layout.pivotX) + l.anchoredPositionX;
      const py = parentHeight * (l.anchorMinY + (l.anchorMaxY - l.anchorMinY) * l.pivotY - parent.control.layout.pivotY) + l.anchoredPositionY;
      const p = parent.matrix;
      x = parent.x + p.a * px + p.c * py; y = parent.y + p.b * px + p.d * py;
      matrix = { a: p.a * local.a + p.c * local.b, b: p.b * local.a + p.d * local.b,
        c: p.a * local.c + p.c * local.d, d: p.b * local.c + p.d * local.d };
    }
    const node = { control, width, height, x, y, matrix, visible: l.active && (parent?.visible ?? true) };
    resolved.set(control.sourceNodeIndex, node);
    return node;
  }
  const nodes: TemplateSceneNode[] = [];
  const children = new Map<number | null, GiaImportedControl[]>();
  for (const control of controls) {
    const key = control.parentSourceNodeIndex !== null && byId.has(control.parentSourceNodeIndex) ? control.parentSourceNodeIndex : null;
    const siblings = children.get(key) ?? []; siblings.push(control); children.set(key, siblings);
  }
  function paint(parent: number | null) {
    // Importer order is top-first; paint bottom-first, keeping each subtree together.
    for (const control of (children.get(parent) ?? []).slice().reverse()) {
      const node = resolve(control);
      if (node.visible) nodes.push(node);
      paint(control.sourceNodeIndex);
    }
  }
  paint(null);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const { width, height, matrix: m, control: { layout: l } } = node;
    for (const dx of [-width * l.pivotX, width * (1 - l.pivotX)]) for (const dy of [-height * l.pivotY, height * (1 - l.pivotY)]) {
      const x = node.x + m.a * dx + m.c * dy, y = node.y + m.b * dx + m.d * dy;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return nodes.length ? { nodes, minX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
    : { nodes, minX: 0, maxY: 1, width: 1, height: 1 };
}
