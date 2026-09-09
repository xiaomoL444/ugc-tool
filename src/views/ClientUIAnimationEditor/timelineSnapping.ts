export type TweenClipSnapMode = "move" | "start" | "end";

export interface TweenClipSnapOptions {
  mode: TweenClipSnapMode;
  /** 拖动开始时的 Clip 时间；每次移动都基于同一份快照。 */
  startTime: number;
  duration: number;
  deltaTime: number;
  sequenceDuration: number;
  minDuration?: number;
  /** 时间轴内容宽度，单位为 CSS px。 */
  laneWidth: number;
  enabled: boolean;
  /** 调用方提供其他 Clip 边界、播放头与序列边界，不包含自身边界。 */
  targets: readonly number[];
}

export interface TweenClipSnapResult {
  startTime: number;
  duration: number;
  snapTime: number | null;
}

const SNAP_DISTANCE_PX = 8;
const TIME_PRECISION = 0.000001;
const EPSILON = 0.000000001;

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function roundTime(value: number) {
  return Number(value.toFixed(6));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 固定像素吸附距离；整体移动保留时长，调整端点保留另一端的位置。 */
export function snapTweenClip(options: TweenClipSnapOptions): TweenClipSnapResult {
  const sequenceDuration = roundTime(Math.max(0, finite(options.sequenceDuration, 0)));
  if (sequenceDuration === 0) return { startTime: 0, duration: 0, snapTime: null };

  const requestedMinDuration = finite(options.minDuration ?? 0.01, 0.01);
  const minDuration = Math.min(sequenceDuration, Math.max(TIME_PRECISION,
    roundTime(requestedMinDuration > 0 ? requestedMinDuration : 0.01)));
  const originalStart = roundTime(clamp(finite(options.startTime, 0), 0, sequenceDuration - minDuration));
  const originalDuration = roundTime(clamp(finite(options.duration, minDuration), minDuration, sequenceDuration - originalStart));
  const originalEnd = roundTime(originalStart + originalDuration);
  const deltaTime = finite(options.deltaTime, 0);
  let startTime = originalStart;
  let endTime = originalEnd;

  if (options.mode === "move") {
    startTime = roundTime(clamp(originalStart + deltaTime, 0, sequenceDuration - originalDuration));
    endTime = roundTime(startTime + originalDuration);
  } else if (options.mode === "start") {
    startTime = roundTime(clamp(originalStart + deltaTime, 0, originalEnd - minDuration));
  } else {
    endTime = roundTime(clamp(originalEnd + deltaTime, originalStart + minDuration, sequenceDuration));
  }

  const result: TweenClipSnapResult = {
    startTime,
    duration: options.mode === "move" ? originalDuration : roundTime(endTime - startTime),
    snapTime: null,
  };
  if (!options.enabled || !Number.isFinite(options.laneWidth) || options.laneWidth <= 0) return result;

  const threshold = SNAP_DISTANCE_PX / options.laneWidth * sequenceDuration;
  const targets = [...new Set(options.targets
    .filter((target) => Number.isFinite(target) && target >= 0 && target <= sequenceDuration)
    .map(roundTime))].sort((a, b) => a - b);
  const edges = options.mode === "move" ? [startTime, endTime] : [options.mode === "start" ? startTime : endTime];
  let bestDistance = Infinity;

  for (const target of targets) {
    for (const edge of edges) {
      const correction = target - edge;
      const distance = Math.abs(correction);
      if (distance > threshold + EPSILON || distance >= bestDistance - EPSILON) continue;

      const candidateStart = options.mode === "end" ? startTime : roundTime(startTime + correction);
      const candidateEnd = options.mode === "start" ? endTime : roundTime(endTime + correction);
      const candidateDuration = options.mode === "move" ? originalDuration : roundTime(candidateEnd - candidateStart);
      // 不可到达的目标不能产生吸附辅助线，也不能改变另一端或压缩移动中的 Clip。
      if (candidateStart < 0 || candidateEnd > sequenceDuration || candidateDuration < minDuration - EPSILON) continue;

      bestDistance = distance;
      result.startTime = candidateStart;
      result.duration = candidateDuration;
      result.snapTime = target;
    }
  }

  return result;
}
