import type { ColorRGBA } from "./types";

export type PrimitiveShape = "ellipse" | "rectangle" | "triangle";
export interface PrimitiveFitOptions {
  defaultsVersion?: number;
  count: number;
  resolution: number;
  workers: number;
  shapes: PrimitiveShape[];
  transparent: boolean;
}
export interface PrimitiveElement {
  type: PrimitiveShape;
  imageId: number;
  /** Image-centred, Y-up coordinates; dimensions are full widths, not radii. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: ColorRGBA;
}
export interface PrimitiveFitData {
  version: 1;
  width: number;
  height: number;
  elements: PrimitiveElement[];
}
export interface PrimitiveProperties {
  imageUrl: string;
  imageResourceId?: string | null;
  previewMode?: "image" | "primitives";
  fitOptions?: PrimitiveFitOptions;
  fitData?: PrimitiveFitData | null;
}
export const PRIMITIVE_IMAGE_IDS: Record<PrimitiveShape, number> = { rectangle: 100001, ellipse: 100002, triangle: 100003 };
export const DEFAULT_PRIMITIVE_OPTIONS: PrimitiveFitOptions = {
  defaultsVersion: 1, count: 400, resolution: 512, workers: 16, shapes: ["ellipse", "rectangle"], transparent: true,
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const bounded = (value: unknown, fallback: number, min: number, max: number) => finite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const shape = (value: unknown): value is PrimitiveShape => value === "ellipse" || value === "rectangle" || value === "triangle";
const round = (value: number) => Math.round(value * 10000) / 10000;

export function normalizePrimitiveOptions(value: unknown): PrimitiveFitOptions {
  const v = record(value) ? value : {};
  const legacyDefaults = v.defaultsVersion === undefined && v.count === 80 && v.resolution === 128 && v.workers === 2;
  const shapes = Array.isArray(v.shapes) ? [...new Set(v.shapes.filter(shape))] : [];
  return { defaultsVersion: 1, count: bounded(legacyDefaults ? undefined : v.count, DEFAULT_PRIMITIVE_OPTIONS.count, 1, 1000), resolution: bounded(legacyDefaults ? undefined : v.resolution, DEFAULT_PRIMITIVE_OPTIONS.resolution, 32, 512),
    workers: bounded(legacyDefaults ? undefined : v.workers, DEFAULT_PRIMITIVE_OPTIONS.workers, 1, 16), shapes: shapes.length ? shapes : [...DEFAULT_PRIMITIVE_OPTIONS.shapes], transparent: v.transparent !== false };
}

/** The engine searches 16 candidates per round; more workers only add overhead. */
export function primitiveWorkerLimit(logicalCores: number = 2): number { return bounded(logicalCores, 2, 1, 16); }

/** Reject incomplete or malformed saved fits as a whole, rather than changing their layering. */
export function normalizePrimitiveData(value: unknown): PrimitiveFitData | null {
  if (!record(value) || value.version !== 1 || !finite(value.width) || !finite(value.height) || value.width <= 0 || value.height <= 0
    || value.width > 32768 || value.height > 32768 || !Array.isArray(value.elements) || !value.elements.length || value.elements.length > 1001) return null;
  const elements: PrimitiveElement[] = [];
  for (const e of value.elements) {
    if (!record(e) || !shape(e.type) || ![e.x, e.y, e.width, e.height, e.rotation].every(finite)
      || Number(e.width) <= 0 || Number(e.height) <= 0 || !record(e.color) || ![e.color.r, e.color.g, e.color.b, e.color.a].every(finite)) return null;
    elements.push({ type: e.type, imageId: PRIMITIVE_IMAGE_IDS[e.type], x: Number(e.x), y: Number(e.y), width: Number(e.width), height: Number(e.height), rotation: Number(e.rotation),
      color: { r: bounded(e.color.r, 255, 0, 255), g: bounded(e.color.g, 255, 0, 255), b: bounded(e.color.b, 255, 0, 255), a: Math.max(0, Math.min(1, Number(e.color.a))) } });
  }
  return { version: 1, width: value.width, height: value.height, elements };
}

export function normalizePrimitiveProperties(value: PrimitiveProperties): PrimitiveProperties {
  const fitData = normalizePrimitiveData(value.fitData);
  return { imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : "", imageResourceId: typeof value.imageResourceId === "string" ? value.imageResourceId : null, fitData,
    fitOptions: normalizePrimitiveOptions(value.fitOptions), previewMode: (fitData || value.imageResourceId) && value.previewMode === "primitives" ? "primitives" : "image" };
}

/** Same contain scaling for original, game-sprite preview and parameter export. */
export function primitiveContentScale(data: PrimitiveFitData, width: number, height: number) {
  return Math.max(0, Math.min(width / data.width, height / data.height));
}

export function buildPrimitiveParameters(data: PrimitiveFitData, name: string, width: number, height: number) {
  const normalized = normalizePrimitiveData(data);
  if (!normalized || !finite(width) || !finite(height) || width <= 0 || height <= 0) throw new Error("没有有效的图元数据或控件尺寸。");
  const scale = primitiveContentScale(normalized, width, height);
  return {
    schema: "UGCTools.PrimitiveImage@1", name,
    coordinateSystem: { origin: "control-center", xAxis: "right", yAxis: "up", angleUnit: "degrees", sizeUnit: "ui-unit" },
    controlSize: { width, height }, sourceSize: { width: data.width, height: data.height },
    elements: normalized.elements.map((e, layer) => ({ type: e.type, imageId: e.imageId, imageType: "basic", layer,
      position: { x: round(e.x * scale), y: round(e.y * scale), z: 0 }, rotation: { x: 0, y: 0, z: e.rotation },
      size: { width: round(e.width * scale), height: round(e.height * scale) }, color: { ...e.color } })),
  };
}

/** Resources export in source pixels independently of any referencing control. */
export function buildPrimitiveResourceParameters(data: PrimitiveFitData, name: string) {
  const { controlSize: _controlSize, ...result } = buildPrimitiveParameters(data, name, data.width, data.height);
  return { ...result, coordinateSystem: { ...result.coordinateSystem, origin: "image-center", sizeUnit: "pixel" } };
}

/** Convert the upstream Go result once; all previews/exports consume this representation. */
export function convertPrimitiveFit(result: unknown, width: number, height: number, whiteBackground: boolean): PrimitiveFitData {
  if (!record(result) || !Array.isArray(result.shapes)) throw new Error("拟合引擎未返回图元数据。");
  const elements: PrimitiveElement[] = result.shapes.map((raw: unknown) => {
    if (!record(raw) || !["circle", "rect", "triangle"].includes(String(raw.type)) || typeof raw.color !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.color)
      || ![raw.cx, raw.cy, raw.angle, raw.alpha].every(finite)) throw new Error("拟合引擎返回了无效图元。");
    const type: PrimitiveShape = raw.type === "circle" ? "ellipse" : raw.type === "rect" ? "rectangle" : "triangle";
    return { type, imageId: PRIMITIVE_IMAGE_IDS[type], x: round(Number(raw.cx) - width / 2), y: round(height / 2 - Number(raw.cy)),
      width: type === "ellipse" ? 2 * Number(raw.rx) : type === "rectangle" ? 2 * Number(raw.hw) : Number(raw.width),
      height: type === "ellipse" ? 2 * Number(raw.ry) : type === "rectangle" ? 2 * Number(raw.hh) : Number(raw.height), rotation: -Number(raw.angle),
      color: { r: parseInt(raw.color.slice(1, 3), 16), g: parseInt(raw.color.slice(3, 5), 16), b: parseInt(raw.color.slice(5, 7), 16), a: Number(raw.alpha) } };
  });
  if (whiteBackground) elements.unshift({ type: "rectangle", imageId: 100001, x: 0, y: 0, width, height, rotation: 0, color: { r: 255, g: 255, b: 255, a: 1 } });
  const data = normalizePrimitiveData({ version: 1, width, height, elements });
  if (!data) throw new Error("拟合结果为空或尺寸无效，请调整图片和参数后重试。");
  return data;
}
