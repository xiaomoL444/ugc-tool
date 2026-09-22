import type { UITimelineEvent, UINode } from "./types";

export function normalizeTimelineEvents(value: unknown, nodes: UINode[], restoreSavedParams = false): UITimelineEvent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000) throw new Error("事件列表无效或超过 10000 个");
  const ids = new Set<string>(), targets = new Set(nodes.map(n => n.id));
  return value.map(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error("事件 ID 缺失或重复");
    if (!Number.isFinite(item.time) || item.time < 0) throw new Error("事件时间必须为非负有限数值");
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || /[\x00-\x1f]/.test(item.name)) throw new Error("事件名称无效（1–80 字）");
    if (item.nodeId !== null && !targets.has(item.nodeId)) throw new Error("事件目标控件不存在");
    // Old projects used structured parameters. Migrate only at the save-loading
    // boundary; the result is opaque text, never parsed by the Lua runtime.
    // Do not truncate saved content, including strings above today's input limit.
    const params = restoreSavedParams && typeof item.params !== "string"
      ? item.params == null ? "" : JSON.stringify(item.params)
      : item.params;
    if (typeof params !== "string") throw new Error("事件参数须为字符串");
    if (!restoreSavedParams && params.length > 4096) throw new Error(`事件「${item.name}」参数超过 4096 字，请缩短后再应用或导出`);
    ids.add(item.id);
    return { id: item.id, time: item.time, name: item.name.trim(), nodeId: item.nodeId, params };
  });
}

/** Array order breaks time ties. Seek never calls this playback-only helper. */
export function crossedTimelineEvents(events: UITimelineEvent[], from: number, to: number, includeStart = false): UITimelineEvent[] {
  if (to < from) return [];
  return events.filter(e => (includeStart ? e.time >= from : e.time > from) && e.time <= to).sort((a, b) => a.time - b.time);
}
