export const DEFAULT_DIRECTION_ARROW_LENGTH = 160;
export const MAX_DIRECTION_ARROW_LENGTH = 2000;

export function normalizeDirectionArrowLength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DIRECTION_ARROW_LENGTH;
  return Math.round(Math.max(0, Math.min(MAX_DIRECTION_ARROW_LENGTH, value)) * 100) / 100;
}

interface GuideWorldTransform {
  x: number;
  y: number;
  matrix: { a: number; b: number; c: number; d: number };
}

/** 世界坐标是 Pivot 所在位置；SVG 向右的局部轴对应控件的 +X。 */
export function containerDirectionGuideStyle(world: GuideWorldTransform, canvasHeight: number) {
  const { a, b, c, d } = world.matrix;
  return {
    left: `${world.x}px`,
    top: `${canvasHeight - world.y}px`,
    transform: `matrix(${a}, ${-b}, ${-c}, ${d}, 0, 0)`,
  };
}

export function directionArrowPath(value: number): string {
  const length = normalizeDirectionArrowLength(value);
  const halfWidth = Math.min(12, length / 3);
  const shoulder = Math.min(24, length * 0.28);
  return `M ${length} 0 L ${shoulder} ${halfWidth} L 0 0 L ${shoulder} ${-halfWidth} Z`;
}
