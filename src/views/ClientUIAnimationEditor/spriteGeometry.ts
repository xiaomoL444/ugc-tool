export interface SpriteMetadata {
  width: number; height: number;
  left: number; bottom: number; right: number; top: number;
  pixelsPerUnit: number;
}
export function parseSpriteMetadata(raw: unknown): SpriteMetadata | undefined {
  const data = raw as { m_Rect?: Record<string, number>; m_Border?: Record<string, number>; m_PixelsToUnits?: number } | null;
  const rect = data?.m_Rect;
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || !(rect.width > 0) || !(rect.height > 0)) return undefined;
  const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
  const border = data?.m_Border;
  return {
    width: rect.width, height: rect.height,
    // Unity Vector4 order: left, bottom, right, top. Exported PNGs use the full sprite rect.
    left: finite(border?.X), bottom: finite(border?.Y), right: finite(border?.Z), top: finite(border?.W),
    pixelsPerUnit: finite(data?.m_PixelsToUnits, 1) || 1,
  };
}
export function isStretchable(metadata?: SpriteMetadata) {
  return Boolean(metadata && (metadata.left || metadata.bottom || metadata.right || metadata.top));
}
export interface SpriteSlice { x: number; y: number; width: number; height: number; viewBox: string }
export function spriteSlices(metadata: SpriteMetadata, width: number, height: number, stretch: boolean): SpriteSlice[] {
  if (!(width > 0) || !(height > 0)) return [];
  if (!stretch || !isStretchable(metadata)) return [{ x: 0, y: 0, width, height, viewBox: `0 0 ${metadata.width} ${metadata.height}` }];
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
  const slices: SpriteSlice[] = [];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const sourceX = sample(horizontal.source, column);
    const sourceY = sample(vertical.source, row);
    const targetWidth = horizontal.target[column + 1] - horizontal.target[column];
    const targetHeight = vertical.target[row + 1] - vertical.target[row];
    if (sourceX.size <= 0 || sourceY.size <= 0 || targetWidth <= 0 || targetHeight <= 0) continue;
    slices.push({ x: horizontal.target[column], y: vertical.target[row], width: targetWidth, height: targetHeight, viewBox: `${sourceX.start} ${sourceY.start} ${sourceX.size} ${sourceY.size}` });
  }
  return slices;
}
