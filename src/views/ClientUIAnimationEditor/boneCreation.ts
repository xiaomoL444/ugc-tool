import { MAX_DIRECTION_ARROW_LENGTH } from "./containerDirectionGuide";

export interface BonePoint { x: number; y: number }
export interface BoneMatrix { a: number; b: number; c: number; d: number }
export interface BoneWorld extends BonePoint { matrix: BoneMatrix }
export const BONE_THICKNESS = 25;

function inverse(matrix: BoneMatrix, point: BonePoint): BonePoint | null {
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(det) || Math.abs(det) < 0.000001) return null;
  return { x: (matrix.d * point.x - matrix.c * point.y) / det, y: (-matrix.b * point.x + matrix.a * point.y) / det };
}

/** Bone +X points from the press to release; its pivot is at the left edge. */
export function boneGeometry(start: BonePoint, end: BonePoint, parent: BoneWorld) {
  const offset = inverse(parent.matrix, { x: start.x - parent.x, y: start.y - parent.y });
  const direction = inverse(parent.matrix, { x: end.x - start.x, y: end.y - start.y });
  if (!offset || !direction) return null;
  const distance = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(distance) || distance < 1) return null;
  return { offset, length: Math.round(Math.min(MAX_DIRECTION_ARROW_LENGTH, distance) * 100) / 100, rotation: Math.atan2(direction.y, direction.x) * 180 / Math.PI };
}

/** Returns a representable local SRT, rather than silently discarding shear. */
export function boneAttachmentTransform(world: BoneWorld, parent: BoneWorld) {
  const offset = inverse(parent.matrix, { x: world.x - parent.x, y: world.y - parent.y });
  const x = inverse(parent.matrix, { x: world.matrix.a, y: world.matrix.b });
  const y = inverse(parent.matrix, { x: world.matrix.c, y: world.matrix.d });
  if (!offset || !x || !y) return null;
  const scaleX = Math.hypot(x.x, x.y), yLength = Math.hypot(y.x, y.y);
  if (Math.abs(x.x * y.x + x.y * y.y) > 0.000001 * Math.max(1, scaleX * yLength)) return null;
  const rotation = scaleX > 0.000001 ? Math.atan2(x.y, x.x) : Math.atan2(-y.x, y.y);
  const scaleY = scaleX > 0.000001 ? (x.x * y.y - x.y * y.x) / scaleX : yLength;
  return { offset, rotation: rotation * 180 / Math.PI, scaleX, scaleY };
}

/** Pixel-space capsule picking also works when the bone is outside its container. */
export function distanceToBone(point: BonePoint, start: BonePoint, end: BonePoint) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
