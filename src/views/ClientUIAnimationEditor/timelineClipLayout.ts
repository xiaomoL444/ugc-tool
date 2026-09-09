import type { UITweenTrack } from "./types";

export const TWEEN_CLIP_TIME_EPSILON = 0.000001;

type TweenClipInterval = Pick<UITweenTrack, "nodeId" | "fieldKey" | "startTime" | "duration">;
type TweenClipLayout = TweenClipInterval & Pick<UITweenTrack, "id">;

export interface TweenClipGap {
  startTime: number;
  duration: number;
}

export interface TweenClipBounds {
  minStart: number;
  maxEnd: number;
}

function roundTime(value: number) {
  return Number(value.toFixed(6));
}

function validInterval(clip: TweenClipInterval) {
  return Number.isFinite(clip.startTime) && Number.isFinite(clip.duration) && clip.duration > 0;
}

function sameLane(a: TweenClipInterval, b: TweenClipInterval) {
  return a.nodeId === b.nodeId && a.fieldKey === b.fieldKey;
}

/** 同一属性轨道不可重叠；前一段结束与后一段开始相接是合法的。 */
export function tweenClipsOverlap(a: TweenClipInterval, b: TweenClipInterval): boolean {
  if (!sameLane(a, b) || !validInterval(a) || !validInterval(b)) return false;
  return Math.min(a.startTime + a.duration, b.startTime + b.duration)
    - Math.max(a.startTime, b.startTime) > TWEEN_CLIP_TIME_EPSILON;
}

/** 同时开始的不同属性保留原始顺序；不修改调用方的数组。 */
export function orderTweenClips<T extends Pick<UITweenTrack, "startTime">>(tracks: readonly T[]): T[] {
  return tracks.map((track, index) => ({ track, index }))
    .sort((a, b) => a.track.startTime - b.track.startTime || a.index - b.index)
    .map(({ track }) => track);
}

/** 从点击位置创建最多一秒的 Clip；被占用的位置不会偷偷改到其他空档。 */
export function getTweenClipGap(
  tracks: readonly TweenClipInterval[],
  nodeId: string,
  fieldKey: string,
  time: number,
  sequenceDuration: number,
  minDuration = 0.01,
): TweenClipGap | null {
  if (!Number.isFinite(time) || !Number.isFinite(sequenceDuration) || sequenceDuration <= 0) return null;
  const sequenceEnd = roundTime(sequenceDuration);
  const minimum = Math.max(TWEEN_CLIP_TIME_EPSILON,
    Number.isFinite(minDuration) && minDuration > 0 ? roundTime(minDuration) : 0.01);
  const startTime = roundTime(Math.max(0, Math.min(sequenceEnd, time)));
  let maxEnd = sequenceEnd;

  for (const track of tracks) {
    if (track.nodeId !== nodeId || track.fieldKey !== fieldKey || !validInterval(track)) continue;
    const trackEnd = roundTime(track.startTime + track.duration);
    if (trackEnd <= startTime + TWEEN_CLIP_TIME_EPSILON) continue;
    if (track.startTime <= startTime + TWEEN_CLIP_TIME_EPSILON) return null;
    maxEnd = Math.min(maxEnd, track.startTime);
  }

  const available = roundTime(maxEnd - startTime);
  if (available < minimum - TWEEN_CLIP_TIME_EPSILON) return null;
  return { startTime, duration: roundTime(Math.min(Math.max(1, minimum), available)) };
}

/**
 * 以拖动开始时的 Clip 快照为准，限制在左右邻居之间，不能一次越过其他 Clip。
 * 移动时可用起点范围为 [minStart, maxEnd - duration]；端点缩放使用相同边界。
 */
export function getTweenClipBounds(
  track: TweenClipLayout,
  tracks: readonly TweenClipLayout[],
  sequenceDuration: number,
): TweenClipBounds {
  const sequenceEnd = Number.isFinite(sequenceDuration) ? roundTime(Math.max(0, sequenceDuration)) : 0;
  let minStart = 0;
  let maxEnd = sequenceEnd;
  const trackEnd = roundTime(track.startTime + track.duration);

  for (const other of tracks) {
    if (other.id === track.id || !sameLane(track, other) || !validInterval(other)) continue;
    const otherEnd = roundTime(other.startTime + other.duration);
    if (otherEnd <= track.startTime + TWEEN_CLIP_TIME_EPSILON) {
      minStart = Math.max(minStart, otherEnd);
    } else if (other.startTime >= trackEnd - TWEEN_CLIP_TIME_EPSILON) {
      maxEnd = Math.min(maxEnd, other.startTime);
    } else {
      // 外部输入若已有重叠，先禁止继续扩大冲突；导入层应单独拒绝这种数据。
      return { minStart: roundTime(Math.max(0, track.startTime)), maxEnd: Math.min(sequenceEnd, trackEnd) };
    }
  }

  return { minStart: roundTime(minStart), maxEnd: roundTime(maxEnd) };
}
