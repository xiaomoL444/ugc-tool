import {
  applyTweenEase, getGroupAlphaColorFields, getTweenableField, getTweenGroupNodes,
  GROUP_ALPHA_FIELD_KEY, GROUP_ALPHA_MAX, isRelativeTweenField, isTweenEaseType,
} from "./tweenRegistry";
import { TWEEN_CLIP_TIME_EPSILON } from "./timelineClipLayout";
import type { ColorRGBA, UIKeyframe, UIKeyframeTrack, UITweenTrack, UITweenValue, UINode } from "./types";

export const KEYFRAME_TIME_EPSILON = TWEEN_CLIP_TIME_EPSILON;

/** value/incomingValue are resolved values; baseline is the preceding valid key's right-side value. */
export interface ResolvedUIKeyframe extends UIKeyframe {
  incomingValue: UITweenValue;
  baseline: UITweenValue;
}

function cloneValue(value: UITweenValue): UITweenValue {
  return value !== null && typeof value === "object" ? { ...value } : value;
}

function cloneKeyframe(key: UIKeyframe): UIKeyframe {
  return { ...key, value: cloneValue(key.value),
    ...(key.incomingValue !== undefined ? { incomingValue: cloneValue(key.incomingValue) } : {}) };
}

function isColor(value: unknown): value is ColorRGBA {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const color = value as ColorRGBA;
  return [color.r, color.g, color.b, color.a].every(Number.isFinite)
    && color.r >= 0 && color.r <= 255 && color.g >= 0 && color.g <= 255
    && color.b >= 0 && color.b <= 255 && color.a >= 0 && color.a <= 1;
}

function isFiniteValue(value: unknown): value is Exclude<UITweenValue, null> {
  return typeof value === "number" ? Number.isFinite(value) : isColor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Stable, non-mutating chronological order. */
export function sortKeyframes<T extends Pick<UIKeyframe, "time">>(keyframes: readonly T[]): T[] {
  return keyframes.map((key, index) => ({ key, index }))
    .sort((left, right) => left.key.time - right.key.time || left.index - right.index)
    .map(({ key }) => key);
}

function resolveValue(value: UITweenValue, relative: boolean | undefined, baseline: UITweenValue, fieldKey: string): UITweenValue {
  if (!isFiniteValue(value)) return null;
  if (!relative) return cloneValue(value);
  if (!isRelativeTweenField(fieldKey) || typeof value !== "number" || typeof baseline !== "number" || !Number.isFinite(baseline)) return null;
  const resolved = baseline + value;
  return Number.isFinite(resolved) ? resolved : null;
}

/** Always resolves from the unchanged setup value; scrubbing does not accumulate relative offsets. */
export function resolveKeyframeTrack(track: UIKeyframeTrack, base: UITweenValue): ResolvedUIKeyframe[] {
  let baseline = cloneValue(base);
  return sortKeyframes(track.keyframes).map((key) => {
    const value = resolveValue(key.value, key.relative, baseline, track.fieldKey);
    const incoming = key.incomingValue === undefined ? cloneValue(value)
      : resolveValue(key.incomingValue, key.incomingRelative, baseline, track.fieldKey);
    const resolved = { ...cloneKeyframe(key), value, incomingValue: incoming, baseline: cloneValue(baseline) };
    if (value !== null) baseline = cloneValue(value);
    return resolved;
  });
}

function interpolateValues(from: UITweenValue, to: UITweenValue, progress: number): UITweenValue {
  if (typeof from === "number" && typeof to === "number") {
    const value = from + (to - from) * progress;
    return Number.isFinite(value) ? value : null;
  }
  if (isColor(from) && isColor(to)) {
    const lerp = (start: number, end: number, max: number) => Math.max(0, Math.min(max, start + (end - start) * progress));
    return { r: lerp(from.r, to.r, 255), g: lerp(from.g, to.g, 255), b: lerp(from.b, to.b, 255), a: lerp(from.a, to.a, 1) };
  }
  return cloneValue(from);
}

/** Before the first key and after the last key, hold its value (including isolated keys). */
export function evaluateKeyframeTrack(track: UIKeyframeTrack, time: number, base: UITweenValue): UITweenValue {
  const keys = resolveKeyframeTrack(track, base);
  if (!keys.length) return cloneValue(base);
  if (Number.isNaN(time) || time < keys[0].time) return cloneValue(keys[0].value);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    const next = keys[index + 1];
    if (time >= next.time) continue;
    if (key.interpolation === "step" || key.value === null || next.incomingValue === null) return cloneValue(key.value);
    const progress = (time - key.time) / (next.time - key.time);
    return interpolateValues(key.value, next.incomingValue, applyTweenEase(key.easeType, progress));
  }
  return cloneValue(keys[keys.length - 1].value);
}

/** Insert/update one time position while preserving an existing key's stable ID and left limit. */
export function upsertKeyframe(track: UIKeyframeTrack, keyframe: UIKeyframe): UIKeyframeTrack {
  if (!Number.isFinite(keyframe.time) || keyframe.time < 0) throw new Error("关键帧时间必须是大于等于 0 的有限数字。");
  const atTime = track.keyframes.filter((key) => Math.abs(key.time - keyframe.time) <= KEYFRAME_TIME_EPSILON);
  if (atTime.length > 1) throw new Error("轨道在该时间存在重复关键帧，无法确定更新目标。");
  const byId = track.keyframes.find((key) => key.id === keyframe.id);
  if (byId && atTime[0] && byId !== atTime[0]) throw new Error("目标时间已有另一个关键帧。");
  const existing = atTime[0] ?? byId;
  const replacement = cloneKeyframe({ ...existing, ...keyframe,
    id: existing?.id ?? keyframe.id, time: atTime[0]?.time ?? keyframe.time });
  return { ...track, keyframes: sortKeyframes([
    ...track.keyframes.filter((key) => key !== existing).map(cloneKeyframe), replacement,
  ]) };
}

/** Strict loading for the keyframe format: invalid data never silently drops a lane or key. */
export function normalizeKeyframeTracks(raw: unknown, nodes: readonly UINode[]): UIKeyframeTrack[] {
  if (!Array.isArray(raw)) throw new Error("关键帧轨道必须是数组。");
  if (raw.length > 10000) throw new Error("关键帧轨道数量超过 10000。");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const trackIds = new Set<string>();
  const keyIds = new Set<string>();
  const lanes = new Set<string>();
  const colorOwners = new Map<string, string>();
  let keyCount = 0;
  const requiredId = (value: unknown, label: string) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label}必须是非空字符串。`);
    return value;
  };
  return raw.map((entry, trackIndex) => {
    const label = `第 ${trackIndex + 1} 条关键帧轨道`;
    if (!isRecord(entry)) throw new Error(`${label}格式无效。`);
    const id = requiredId(entry.id, `${label} ID`);
    if (trackIds.has(id)) throw new Error(`${label} ID「${id}」重复。`);
    trackIds.add(id);
    const nodeId = requiredId(entry.nodeId, `${label}控件 ID`);
    const fieldKey = requiredId(entry.fieldKey, `${label}字段`);
    const node = byId.get(nodeId);
    if (!node) throw new Error(`${label}找不到控件「${nodeId}」。`);
    const field = getTweenableField(node.type, fieldKey);
    if (!field) throw new Error(`控件「${node.name}」不支持 Tween 字段 ${fieldKey}。`);
    const laneId = `${nodeId}\0${fieldKey}`;
    if (lanes.has(laneId)) throw new Error(`控件「${node.name}」的 ${fieldKey} 关键帧轨道重复。`);
    lanes.add(laneId);
    if (!Array.isArray(entry.keyframes)) throw new Error(`${label}的 keyframes 必须是数组。`);
    keyCount += entry.keyframes.length;
    if (keyCount > 100000) throw new Error("关键帧总数超过 100000。");
    const validateValue = (value: unknown, valueLabel: string): UITweenValue => {
      if (value === null) return null;
      if (field.valueKind === "number" ? typeof value !== "number" || !Number.isFinite(value) : !isColor(value)) {
        throw new Error(`${valueLabel}必须是有效${field.valueKind === "number" ? "数字" : "ColorRGBA 颜色"}。`);
      }
      if (fieldKey === GROUP_ALPHA_FIELD_KEY && (Number(value) < 0 || Number(value) > GROUP_ALPHA_MAX)) throw new Error(`${valueLabel}透明度必须位于 0–255。`);
      return cloneValue(value as UITweenValue);
    };
    const keyframes = sortKeyframes(entry.keyframes.map((item, keyIndex): UIKeyframe => {
      const keyLabel = `「${node.name} / ${fieldKey}」第 ${keyIndex + 1} 个关键帧`;
      if (!isRecord(item)) throw new Error(`${keyLabel}格式无效。`);
      const keyId = requiredId(item.id, `${keyLabel} ID`);
      if (keyIds.has(keyId)) throw new Error(`${keyLabel} ID「${keyId}」重复。`);
      keyIds.add(keyId);
      if (typeof item.time !== "number" || !Number.isFinite(item.time) || item.time < 0) throw new Error(`${keyLabel}时间必须是大于等于 0 的有限数字。`);
      if (!isTweenEaseType(item.easeType)) throw new Error(`${keyLabel}缓动类型无效。`);
      if (item.interpolation !== "tween" && item.interpolation !== "step") throw new Error(`${keyLabel}插值必须是 tween 或 step。`);
      for (const flag of ["relative", "incomingRelative"]) {
        if (item[flag] !== undefined && typeof item[flag] !== "boolean") throw new Error(`${keyLabel}的 ${flag} 必须是布尔值。`);
        if (item[flag] === true && !isRelativeTweenField(fieldKey)) throw new Error(`${keyLabel}字段不支持增量。`);
      }
      const value = validateValue(item.value, `${keyLabel}值`);
      const hasIncoming = item.incomingValue !== undefined;
      if (item.incomingRelative === true && !hasIncoming) throw new Error(`${keyLabel}缺少 incomingValue。`);
      return { id: keyId, time: item.time, value, easeType: item.easeType, interpolation: item.interpolation,
        ...(item.relative === true ? { relative: true } : {}),
        ...(hasIncoming ? { incomingValue: validateValue(item.incomingValue, `${keyLabel}左极限值`),
          ...(item.incomingRelative === true ? { incomingRelative: true } : {}) } : {}) };
    }));
    for (let index = 1; index < keyframes.length; index += 1) {
      if (keyframes[index].time - keyframes[index - 1].time <= KEYFRAME_TIME_EPSILON) {
        throw new Error(`「${node.name} / ${fieldKey}」在 ${keyframes[index].time} 秒存在重复关键帧。`);
      }
    }
    if (field.source === "group" || field.valueKind === "color") {
      const targets = field.source === "group" ? getTweenGroupNodes(nodeId, [...nodes]) : [node];
      for (const target of targets) {
        for (const color of field.source === "group" ? getGroupAlphaColorFields(target.type) : [fieldKey]) {
          const targetId = `${target.id}\0${color}`;
          const owner = colorOwners.get(targetId);
          if (owner) throw new Error(`「${node.name} / ${fieldKey}」与 ${owner} 同时控制同一颜色。`);
          colorOwners.set(targetId, `「${node.name} / ${fieldKey}」`);
        }
      }
    }
    return { id, nodeId, fieldKey, keyframes };
  });
}

/** Preserve timing, gap holds, discontinuous touching boundaries, and symbolic relative baselines. */
export function migrateTweenClipsToKeyframes(tracks: readonly UITweenTrack[]): UIKeyframeTrack[] {
  const groups = new Map<string, UITweenTrack[]>();
  for (const track of tracks) {
    const laneId = `${track.nodeId}\0${track.fieldKey}`;
    const clips = groups.get(laneId) ?? [];
    clips.push(track);
    groups.set(laneId, clips);
  }
  const ids = new Set<string>();
  const uniqueId = (seed: string) => {
    let id = seed;
    let suffix = 1;
    while (ids.has(id)) id = `${seed}_${suffix++}`;
    ids.add(id);
    return id;
  };
  return [...groups.values()].map((unsorted) => {
    const clips = unsorted.map((track, index) => ({ track, index }))
      .sort((a, b) => a.track.startTime - b.track.startTime || a.index - b.index).map(({ track }) => track);
    const first = clips[0];
    const result: UIKeyframeTrack = { id: uniqueId(`keytrack_${first.id}`), nodeId: first.nodeId, fieldKey: first.fieldKey, keyframes: [] };
    for (const clip of clips) {
      if (!Number.isFinite(clip.startTime) || clip.startTime < 0 || !Number.isFinite(clip.duration)
        || clip.duration <= KEYFRAME_TIME_EPSILON || !Number.isFinite(clip.startTime + clip.duration)) throw new Error(`Clip「${clip.id}」时间无效，无法迁移关键帧。`);
      if (clip.initialValue !== null && !isFiniteValue(clip.initialValue)
        || clip.endValue !== null && !isFiniteValue(clip.endValue)
        || clip.initialValue !== null && clip.endValue !== null && typeof clip.initialValue !== typeof clip.endValue) {
        throw new Error(`Clip「${clip.id}」首尾值类型无效，无法迁移关键帧。`);
      }
      const relative = clip.relative === true;
      if (relative && (!isRelativeTweenField(clip.fieldKey)
        || clip.initialValue !== null && typeof clip.initialValue !== "number"
        || clip.endValue !== null && typeof clip.endValue !== "number")) throw new Error(`Clip「${clip.id}」字段不支持增量。`);
      if (!isTweenEaseType(clip.easeType)) throw new Error(`Clip「${clip.id}」缓动类型无效。`);
      const last = result.keyframes[result.keyframes.length - 1];
      if (last && clip.startTime < last.time - KEYFRAME_TIME_EPSILON) throw new Error(`Clip「${clip.id}」与同轨道其他 Clip 重叠，无法迁移关键帧。`);
      const start: UIKeyframe = { id: uniqueId(`key_${clip.id}_start`), time: clip.startTime,
        value: cloneValue(clip.initialValue), ...(relative ? { relative: true } : {}), easeType: clip.easeType, interpolation: "tween" };
      if (last && Math.abs(last.time - clip.startTime) <= KEYFRAME_TIME_EPSILON) {
        // At a touching boundary, keep the old end as the left limit and use
        // the next Clip's start on/right of the exact same timestamp.
        const incoming = cloneValue(last.value);
        const incomingRelative = last.relative === true;
        if (relative) {
          if (last.value === null || clip.initialValue === null) {
            // An unset previous key contributes no baseline; retain the raw
            // offset (or null) rather than fabricating a numeric endpoint.
            last.value = cloneValue(clip.initialValue);
            last.relative = true;
          } else {
            if (typeof last.value !== "number") throw new Error(`Clip「${clip.id}」无法相对颜色计算增量。`);
            last.value += clip.initialValue as number;
            if (!Number.isFinite(last.value)) throw new Error(`Clip「${clip.id}」增量计算溢出。`);
          }
        } else {
          last.value = cloneValue(clip.initialValue);
          delete last.relative;
        }
        last.incomingValue = incoming;
        if (incomingRelative) last.incomingRelative = true;
        else delete last.incomingRelative;
        last.easeType = clip.easeType;
        last.interpolation = "tween";
      } else {
        result.keyframes.push(start);
      }
      const endValue = relative && clip.initialValue !== null && clip.endValue !== null
        ? (clip.endValue as number) - (clip.initialValue as number) : cloneValue(clip.endValue);
      if (typeof endValue === "number" && !Number.isFinite(endValue)) throw new Error(`Clip「${clip.id}」端点增量计算溢出。`);
      result.keyframes.push({ id: uniqueId(`key_${clip.id}_end`), time: clip.startTime + clip.duration,
        value: endValue, ...(relative ? { relative: true } : {}), easeType: "Linear", interpolation: "step" });
    }
    return result;
  });
}

/**
 * Compatibility-only preview clips. Zero-duration constant points retain lone,
 * step-ending and final keys; they are not native Tweens or fake .01s transitions.
 * New Lua export must consume keyframes directly, not this lossy legacy adapter.
 */
export function compileKeyframesToTweenClips(
  tracks: readonly UIKeyframeTrack[],
  getBaseValue: (track: UIKeyframeTrack) => UITweenValue,
): UITweenTrack[] {
  return tracks.flatMap((track) => {
    const keys = resolveKeyframeTrack(track, getBaseValue(track));
    return keys.flatMap((key, index): UITweenTrack[] => {
      if (key.value === null) return [];
      const next = keys[index + 1];
      const tween = key.interpolation === "tween" && next?.incomingValue !== null;
      return [{ id: `${track.id}:${key.id}`, nodeId: track.nodeId, fieldKey: track.fieldKey,
        startTime: key.time, duration: next ? next.time - key.time : 0,
        initialValue: cloneValue(key.value), endValue: cloneValue(next && tween ? next.incomingValue : key.value),
        easeType: tween ? key.easeType : "Linear", relative: false }];
    });
  });
}
