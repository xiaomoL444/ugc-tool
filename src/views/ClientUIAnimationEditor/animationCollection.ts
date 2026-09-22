import type { UIAnimation, UINode } from "./types";
import { normalizeKeyframeTracks } from "./keyframeTimeline";
import { normalizeTimelineEvents } from "./timelineEvents";

export function normalizeAnimationCollection(value: unknown, nodes: UINode[]): UIAnimation[] {
  if (!Array.isArray(value) || !value.length) throw new Error("工程必须包含至少一个 Animation");
  const ids = new Set<string>(), names = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Animation 数据无效");
    const saved = item as Record<string, unknown>;
    const name = typeof saved.name === "string" ? saved.name.trim() : "";
    if (typeof saved.id !== "string" || !saved.id || ids.has(saved.id)) throw new Error("Animation ID 缺失或重复");
    if (!name || name.length > 80 || /[\x00-\x1f]/.test(name) || names.has(name)) throw new Error("Animation 名称无效或重复");
    if (typeof saved.duration !== "number" || !Number.isFinite(saved.duration) || saved.duration <= 0) throw new Error(`「${name}」的时长无效`);
    const keyframeTracks = normalizeKeyframeTracks(saved.keyframeTracks, nodes);
    const events = normalizeTimelineEvents(saved.events, nodes, true);
    ids.add(saved.id); names.add(name);
    return { id: saved.id, name, duration: Math.max(0.5, saved.duration, ...events.map(e => e.time), ...keyframeTracks.flatMap(track => track.keyframes.map(key => key.time))), keyframeTracks, ...(saved.events === undefined ? {} : { events }) };
  });
}

export function uniqueAnimationName(animations: UIAnimation[], base: string): string {
  const names = new Set(animations.map(animation => animation.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index++;
  return `${base} ${index}`;
}
