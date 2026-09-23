import type { Layer, LayerMaskData, PixelData, Psd } from "ag-psd";
import { createControlProperties } from "./controlRegistry";
import type { PrimitiveImageResource } from "./primitiveResources";
import type { UINode } from "./types";

export interface PsdImportResult { width: number; height: number; nodes: UINode[]; resources: PrimitiveImageResource[]; folders: number; layers: number; hidden: number; warnings: string[] }
interface Bounds { left: number; top: number; right: number; bottom: number }
type EncodeImage = (pixels: Uint8ClampedArray, width: number, height: number) => Promise<string>;
const opacity = (value: number | undefined) => Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 1;

export function validatePsdHeader(buffer: ArrayBuffer) {
  if (buffer.byteLength < 26) throw new Error("文件不完整，不是有效的 PSD。");
  const v = new DataView(buffer);
  if (v.getUint32(0) !== 0x38425053) throw new Error("请选择 Photoshop PSD 文件。");
  if (v.getUint16(4) !== 1) throw new Error("暂不支持 PSB 大型文档，请另存为 PSD。");
  if (v.getUint16(22) !== 8 || ![1, 3].includes(v.getUint16(24))) throw new Error("请将 PSD 转为 8 位 RGB 或灰度模式后导入。");
  const width = v.getUint32(18), height = v.getUint32(14);
  if (!width || !height || width > 16384 || height > 16384 || width * height > 32000000) throw new Error("PSD 画布过大，请缩小到 3200 万像素以内，单边不超过 16384 像素。");
}

/** PSD raster masks use document coordinates (or explicitly layer-relative offsets). */
function maskAlpha(mask: LayerMaskData, x: number, y: number, layer: Layer) {
  if (mask.disabled) return 1;
  const data = mask.imageData;
  const mx = Math.floor(x - (mask.left ?? 0) - (mask.positionRelativeToLayer ? layer.left ?? 0 : 0));
  const my = Math.floor(y - (mask.top ?? 0) - (mask.positionRelativeToLayer ? layer.top ?? 0 : 0));
  const value = data && mx >= 0 && my >= 0 && mx < data.width && my < data.height ? data.data[(my * data.width + mx) * 4] : mask.defaultColor ?? 255;
  return Math.max(0, Math.min(1, value / 255));
}

/** Build detached project data: an unsuccessful decode never changes the open editor. */
export async function convertPsdDocument(psd: Psd, name: string, encode: EncodeImage, progress: (done: number, total: number) => void = () => {}): Promise<PsdImportResult> {
  if (!psd.children?.length) throw new Error("PSD 没有可导入的图层，请保存包含图层的 PSD。");
  const bounds = new Map<Layer, Bounds | null>();
  let total = 0;
  function measure(layer: Layer, depth: number): Bounds | null {
    if (++total > 1024 || depth > 64) throw new Error("PSD 层级过多，最多支持 1024 个图层与文件夹、64 层嵌套。");
    let box: Bounds | null = null;
    if (layer.children) {
      for (const child of layer.children) {
        const b = measure(child, depth + 1);
        if (b) box = box ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top), right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) } : b;
      }
    } else if (layer.imageData) {
      const p = layer.imageData;
      if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width <= 0 || p.height <= 0 || p.width * p.height > 32000000 || p.data.length !== p.width * p.height * 4) throw new Error(`图层「${layer.name ?? "未命名"}」的像素数据无效。`);
      box = { left: layer.left ?? 0, top: layer.top ?? 0, right: (layer.left ?? 0) + p.width, bottom: (layer.top ?? 0) + p.height };
    }
    if (box && !Object.values(box).every(Number.isFinite)) throw new Error("PSD 图层位置无效。");
    bounds.set(layer, box); return box;
  }
  psd.children.forEach(layer => measure(layer, 1));
  const warnings = new Set<string>();
  const result: PsdImportResult = { width: psd.width, height: psd.height, nodes: [], resources: [], folders: 0, layers: 0, hidden: 0, warnings: [] };
  const canvas = { left: 0, top: 0, right: psd.width, bottom: psd.height };
  function nodeFor(name: string, type: "primitive" | "container", box: Bounds, parent: Bounds, parentId: string | null, visible: boolean): UINode {
    const width = box.right - box.left, height = box.bottom - box.top;
    const x = box.left - parent.left + width / 2, y = parent.bottom - box.bottom + height / 2;
    return { id: `psd-node-${result.nodes.length}`, name, type, parentId, active: true, visible, locked: false,
      x, y, width, height, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 0,
      pivotX: .5, pivotY: .5, anchorMinX: .5, anchorMinY: .5, anchorMaxX: .5, anchorMaxY: .5,
      anchorOffsetX: x - (parent.right - parent.left) / 2, anchorOffsetY: y - (parent.bottom - parent.top) / 2,
      sizeDeltaX: width, sizeDeltaY: height, canControllerFocus: false, properties: createControlProperties(type),
      ...(type === "container" ? { editor: { directionArrowLength: 0 } } : {}),
    } as UINode;
  }
  const root = nodeFor(name, "container", canvas, canvas, null, true);
  root.anchorMinX = root.anchorMinY = 0; root.anchorMaxX = root.anchorMaxY = 1; root.sizeDeltaX = root.sizeDeltaY = 0;
  result.nodes.push(root);
  let done = 0;
  async function visit(layer: Layer, parentBox: Bounds, parentId: string, inheritedOpacity: number, inheritedMasks: { mask: LayerMaskData; layer: Layer }[]) {
    const group = !!layer.children;
    const box = bounds.get(layer) ?? (group ? parentBox : { left: layer.left ?? 0, top: layer.top ?? 0, right: (layer.left ?? 0) + 1, bottom: (layer.top ?? 0) + 1 });
    const node = nodeFor(layer.name || (group ? "未命名文件夹" : "未命名图层"), group ? "container" : "primitive", box, parentBox, parentId, !layer.hidden);
    result.nodes.push(node); if (layer.hidden) result.hidden++;
    if (layer.blendMode && !["normal", "pass through"].includes(layer.blendMode)) warnings.add("特殊混合模式按普通叠加显示");
    if (layer.clipping) warnings.add("剪贴蒙版未还原");
    if (layer.effects) warnings.add("图层样式未重新渲染");
    if (layer.adjustment) warnings.add("调整图层未重新渲染");
    if (layer.vectorMask) warnings.add("矢量蒙版按已保存的栅格内容导入");
    const masks = [...inheritedMasks];
    const mask = layer.realMask ?? layer.mask;
    if (mask && !mask.disabled) { masks.push({ mask, layer }); if (mask.userMaskFeather || mask.userMaskDensity !== undefined) warnings.add("蒙版羽化和密度未还原"); }
    const alpha = inheritedOpacity * opacity(layer.opacity) * opacity(layer.fillOpacity);
    if (group) {
      result.folders++;
      if (opacity(layer.opacity) !== 1) warnings.add("文件夹不透明度已分摊到子图层，重叠区域可能不同");
      // ag-psd's decoded array is bottom-to-top; the editor tree is top-to-bottom.
      for (const child of [...layer.children!].reverse()) await visit(child, box, node.id, alpha, masks);
    } else {
      result.layers++;
      const pixels: PixelData = layer.imageData ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) };
      if (!layer.imageData) warnings.add("无像素的空图层已保留为透明资源");
      const rgba = new Uint8ClampedArray(pixels.data);
      for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
        let a = alpha;
        for (const item of masks) a *= maskAlpha(item.mask, box.left + x, box.top + y, item.layer);
        const i = (y * pixels.width + x) * 4 + 3; rgba[i] = Math.round(rgba[i] * a);
      }
      const imageUrl = await encode(rgba, pixels.width, pixels.height);
      const id = `psd-image-${result.layers}`;
      result.resources.push({ id, name: node.name, imageUrl, previewMode: "image", fitData: null });
      if (node.type === "primitive") node.properties = { imageUrl: "", imageResourceId: id, previewMode: "image" };
    }
    progress(++done, total);
  }
  for (const layer of [...psd.children].reverse()) await visit(layer, canvas, root.id, 1, []);
  result.warnings = [...warnings]; return result;
}
