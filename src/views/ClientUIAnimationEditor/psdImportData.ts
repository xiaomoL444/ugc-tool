import { t } from "../../i18n";
import type { Layer, LayerMaskData, PixelData, Psd } from "ag-psd";

import { createControlProperties } from "./controlRegistry";
import type { PrimitiveImageResource } from "./primitiveResources";
import type { UINode } from "./types";

export interface PsdImportResult { width: number; height: number; nodes: UINode[]; resources: PrimitiveImageResource[]; folders: number; layers: number; hidden: number; warnings: string[] }
interface Bounds { left: number; top: number; right: number; bottom: number }
type EncodeImage = (pixels: Uint8ClampedArray, width: number, height: number) => Promise<string>;
const opacity = (value: number | undefined) => Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 1;

export function validatePsdHeader(buffer: ArrayBuffer) {
  if (buffer.byteLength < 26) throw new Error(t("clientUIAnimationEditor.ui.psdImport.incompleteFile"));
  const v = new DataView(buffer);
  if (v.getUint32(0) !== 0x38425053) throw new Error(t("clientUIAnimationEditor.ui.psdImport.selectFile"));
  if (v.getUint16(4) !== 1) throw new Error(t("clientUIAnimationEditor.ui.psdImport.psbUnsupported"));
  if (v.getUint16(22) !== 8 || ![1, 3].includes(v.getUint16(24))) throw new Error(t("clientUIAnimationEditor.ui.psdImport.unsupportedColorMode"));
  const width = v.getUint32(18), height = v.getUint32(14);
  if (!width || !height || width > 16384 || height > 16384 || width * height > 32000000) throw new Error(t("clientUIAnimationEditor.ui.psdImport.canvasTooLarge"));
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
  if (!psd.children?.length) throw new Error(t("clientUIAnimationEditor.ui.psdImport.noLayers"));
  const bounds = new Map<Layer, Bounds | null>();
  let total = 0;
  function measure(layer: Layer, depth: number): Bounds | null {
    if (++total > 1024 || depth > 64) throw new Error(t("clientUIAnimationEditor.ui.psdImport.hierarchyLimitExceeded"));
    let box: Bounds | null = null;
    if (layer.children) {
      for (const child of layer.children) {
        const b = measure(child, depth + 1);
        if (b) box = box ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top), right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) } : b;
      }
    } else if (layer.imageData) {
      const p = layer.imageData;
      if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width <= 0 || p.height <= 0 || p.width * p.height > 32000000 || p.data.length !== p.width * p.height * 4) throw new Error(t("clientUIAnimationEditor.ui.psdImport.invalidLayerPixels", { name: layer.name ?? t("clientUIAnimationEditor.ui.psdImport.untitledLayer") }));
      box = { left: layer.left ?? 0, top: layer.top ?? 0, right: (layer.left ?? 0) + p.width, bottom: (layer.top ?? 0) + p.height };
    }
    if (box && !Object.values(box).every(Number.isFinite)) throw new Error(t("clientUIAnimationEditor.ui.psdImport.invalidLayerPosition"));
    bounds.set(layer, box); return box;
  }
  psd.children.forEach(layer => measure(layer, 1));
  const warnings = new Set<string>();
  const addWarning = (message: string) => { warnings.add(message); };
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
    if (layer.blendMode && !["normal", "pass through"].includes(layer.blendMode)) addWarning(t("clientUIAnimationEditor.ui.psdImport.blendModesFlattened"));
    if (layer.clipping) addWarning(t("clientUIAnimationEditor.ui.psdImport.clippingMaskNotRestored"));
    if (layer.effects) addWarning(t("clientUIAnimationEditor.ui.psdImport.layerStylesNotRendered"));
    if (layer.adjustment) addWarning(t("clientUIAnimationEditor.ui.psdImport.adjustmentLayersNotRendered"));
    if (layer.vectorMask) addWarning(t("clientUIAnimationEditor.ui.psdImport.vectorMaskRasterized"));
    const masks = [...inheritedMasks];
    const mask = layer.realMask ?? layer.mask;
    if (mask && !mask.disabled) { masks.push({ mask, layer }); if (mask.userMaskFeather || mask.userMaskDensity !== undefined) addWarning(t("clientUIAnimationEditor.ui.psdImport.maskEffectsNotRestored")); }
    const alpha = inheritedOpacity * opacity(layer.opacity) * opacity(layer.fillOpacity);
    if (group) {
      result.folders++;
      if (opacity(layer.opacity) !== 1) addWarning(t("clientUIAnimationEditor.ui.psdImport.folderOpacityFlattened"));
      // ag-psd's decoded array is bottom-to-top; the editor tree is top-to-bottom.
      for (const child of [...layer.children!].reverse()) await visit(child, box, node.id, alpha, masks);
    } else {
      result.layers++;
      const pixels: PixelData = layer.imageData ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) };
      if (!layer.imageData) addWarning(t("clientUIAnimationEditor.ui.psdImport.emptyLayerTransparentResource"));
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
  result.warnings = [...warnings.values()]; return result;
}
