export interface SpriteMetadata {
  width: number; height: number;
  left: number; bottom: number; right: number; top: number;
  pixelsPerUnit: number;
  trimmedRect?: { x: number; y: number; width: number; height: number };
}
export function parseSpriteMetadata(raw: unknown): SpriteMetadata | undefined {
  const data = raw as {
    m_Rect?: Record<string, number>;
    m_Border?: Record<string, number>;
    m_PixelsToUnits?: number;
    m_RD?: { textureRect?: Record<string, number>; textureRectOffset?: Record<string, number> };
  } | null;
  const rect = data?.m_Rect;
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || !(rect.width > 0) || !(rect.height > 0)) return undefined;
  const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
  const border = data?.m_Border;
  const texture = data?.m_RD?.textureRect;
  const offset = data?.m_RD?.textureRectOffset;
  // textureRect.x/y are atlas coordinates. The offset places a cropped PNG
  // inside the original sprite, measured from its bottom-left corner.
  const trimmedRect = texture && offset && [texture.width, texture.height, offset.X, offset.Y].every(Number.isFinite)
    && texture.width > 0 && texture.height > 0
    ? { x: offset.X, y: rect.height - offset.Y - texture.height, width: texture.width, height: texture.height }
    : undefined;
  return {
    width: rect.width, height: rect.height,
    ...(trimmedRect && { trimmedRect }),
    // Unity Vector4 order: left, bottom, right, top.
    left: finite(border?.X), bottom: finite(border?.Y), right: finite(border?.Z), top: finite(border?.W),
    pixelsPerUnit: finite(data?.m_PixelsToUnits, 1) || 1,
  };
}
export function isStretchable(metadata?: SpriteMetadata) {
  return Boolean(metadata && (metadata.left || metadata.bottom || metadata.right || metadata.top));
}
export interface SpriteSlice { x: number; y: number; width: number; height: number; viewBox: string }
interface SpriteRegion {
  x: number; y: number; width: number; height: number;
  sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number;
}
export function spriteRegions(metadata: SpriteMetadata, width: number, height: number, stretch: boolean): SpriteRegion[] {
  if (!(width > 0) || !(height > 0)) return [];
  if (!stretch || !isStretchable(metadata)) return [{ x: 0, y: 0, width, height, sourceX: 0, sourceY: 0, sourceWidth: metadata.width, sourceHeight: metadata.height }];
  const axis = (source: number, target: number, before: number, after: number) => {
    const sourceScale = Math.min(1, source / (before + after || 1));
    before *= sourceScale; after *= sourceScale;
    const scale = Math.min(1 / metadata.pixelsPerUnit, target / (before + after || 1));
    return { source: [0, before, source - after, source], target: [0, before * scale, target - after * scale, target] };
  };
  const horizontal = axis(metadata.width, width, metadata.left, metadata.right);
  const vertical = axis(metadata.height, height, metadata.top, metadata.bottom);
  const sample = (stops: number[], index: number) => {
    const start = stops[index];
    const size = stops[index + 1] - start;
    if (index !== 1 || size > 0) return { start, size };
    // Unity still draws the middle quad when its UVs coincide. SVG cannot
    // render a zero-sized viewBox, so extend a texel strip at that seam.
    // Keep the original corner geometry and omit genuinely absent outer borders.
    const texel = Math.min(1, stops[3]);
    return { start: Math.max(0, Math.min(stops[3] - texel, start - texel / 2)), size: texel };
  };
  const slices: SpriteRegion[] = [];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const sourceX = sample(horizontal.source, column);
    const sourceY = sample(vertical.source, row);
    const targetWidth = horizontal.target[column + 1] - horizontal.target[column];
    const targetHeight = vertical.target[row + 1] - vertical.target[row];
    if (sourceX.size <= 0 || sourceY.size <= 0 || targetWidth <= 0 || targetHeight <= 0) continue;
    slices.push({ x: horizontal.target[column], y: vertical.target[row], width: targetWidth, height: targetHeight,
      sourceX: sourceX.start, sourceY: sourceY.start, sourceWidth: sourceX.size, sourceHeight: sourceY.size });
  }
  return slices;
}
export function spriteSlices(metadata: SpriteMetadata, width: number, height: number, stretch: boolean): SpriteSlice[] {
  return spriteRegions(metadata, width, height, stretch).map(({ x, y, width, height, sourceX, sourceY, sourceWidth, sourceHeight }) => ({
    x, y, width, height, viewBox: `${sourceX} ${sourceY} ${sourceWidth} ${sourceHeight}`,
  }));
}
