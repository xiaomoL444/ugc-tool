import type { CSSProperties } from 'vue';
import type { ClientUIImageControlProperties } from './types';

/** Clockwise browser approximation; origins follow the existing editor fields. */
export function imageFillMask(values: Partial<ClientUIImageControlProperties>): string | null {
  if (!values.fillType || values.fillType === 'unused') return null;
  const raw = values.fillAmount;
  const amount = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  if (amount === 0) return 'linear-gradient(transparent, transparent)';
  if (amount === 1) return 'linear-gradient(#000, #000)';
  if (values.fillType === 'horizontal' || values.fillType === 'vertical') {
    const direction = values.fillType === 'horizontal'
      ? values.fillHorizontalType === 'right' ? 'to left' : 'to right'
      : values.fillVerticalType === 'top' ? 'to bottom' : 'to top';
    return `linear-gradient(${direction}, #000 ${amount * 100}%, transparent ${amount * 100}%)`;
  }
  let degrees: number, origin: string, start: number;
  if (values.fillType === 'radial90') {
    degrees = 90;
    const positions = {bottomLeft: ['0% 100%', 0], topLeft: ['0% 0%', 90], topRight: ['100% 0%', 180], bottomRight: ['100% 100%', 270]} as const;
    [origin, start] = positions[values.fillRadial90Type ?? 'bottomLeft'];
  } else if (values.fillType === 'radial180') {
    degrees = 180;
    const positions = {bottom: ['50% 100%', 270], left: ['0% 50%', 0], top: ['50% 0%', 90], right: ['100% 50%', 180]} as const;
    [origin, start] = positions[values.fillRadialType ?? 'bottom'];
  } else if (values.fillType === 'radial360') {
    degrees = 360; origin = '50% 50%';
    start = {bottom:180,left:270,top:0,right:90}[values.fillRadialType ?? 'bottom'];
  } else return null;
  return `conic-gradient(from ${start}deg at ${origin}, #000 0deg ${degrees * amount}deg, transparent ${degrees * amount}deg 360deg)`;
}

/** Combines fill and rectangular feathering before applying reverse-mask. */
export function imageFeatherPreview(values: Partial<ClientUIImageControlProperties> | undefined, width: number, height: number): CSSProperties {
  if (!values?.enableMask) return {};
  const finite = (value: number | null | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));
  const edge = (range: number | null | undefined, pixels: number | null | undefined, size: number) => values.softEdgeMode === 'percentage'
    ? (100 - clamp(finite(range, 85), 100)) / 2
    : size > 0 ? Math.max(0, finite(pixels, 8)) / size * 100 : 0;
  const x = edge(values.horizontalSoftRange, values.softEdgeWidthX, width);
  const y = edge(values.verticalSoftRange, values.softEdgeWidthY, height);
  const gradient = (direction: string, amount: number) => {
    if (amount === 0) return 'linear-gradient(#000, #000)';
    // When opposing fades overlap, the center can no longer reach opacity 1.
    // Keep reducing its alpha instead of clamping the feather width to half-size.
    if (amount > 50) return `linear-gradient(${direction}, transparent, rgba(0,0,0,${50 / amount}) 50%, transparent)`;
    return `linear-gradient(${direction}, transparent, #000 ${amount}%, #000 ${100 - amount}%, transparent)`;
  };
  const masks: string[] = values.enableSoftEdge ? [gradient('to right', x), gradient('to bottom', y)] : [];
  const fill = imageFillMask(values);
  if (fill) masks.push(fill);
  if (!masks.length && !values.reverseMaskArea) return {};
  if (!masks.length) masks.push('linear-gradient(#000, #000)');
  const composites = masks.map(() => 'intersect');
  if (values.reverseMaskArea) { masks.unshift('linear-gradient(#000, #000)'); composites.unshift('subtract'); }
  // Omit the final unused operator for a stable, explicit layer pairing.
  return { maskImage: masks.join(', '), maskComposite: composites.slice(0, Math.max(1, masks.length - 1)).join(', '), maskSize: '100% 100%', maskRepeat: 'no-repeat' };
}
