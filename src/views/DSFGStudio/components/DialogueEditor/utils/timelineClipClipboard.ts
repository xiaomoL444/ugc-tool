import { shallowRef } from "vue";
import type { DialogueClip, SelectClip, FocusPushClip, PerformanceClip, PerformanceLine, DialogueNode } from "../types/DialogueNode";

export type TimelineClipSelection =
  | { kind: "dialogue"; clip: DialogueClip }
  | { kind: "select"; clip: SelectClip }
  | { kind: "focusPush"; clip: FocusPushClip }
  | { kind: "performance"; line: PerformanceLine; clip: PerformanceClip };
export type TimelineLane = { kind: "dialogue" } | { kind: "select" } | { kind: "focusPush" }
  | { kind: "performance"; lineId: string };
export type TimelineClipSnapshot = Exclude<TimelineClipSelection, { kind: "performance" }>
  | { kind: "performance"; clip: PerformanceClip };

// Shared across Timeline mounts, so Clips can be pasted into another Group.
export const timelineClipClipboard = shallowRef<TimelineClipSnapshot>();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export function captureTimelineClip(selected: TimelineClipSelection): TimelineClipSnapshot {
  return clone({ kind: selected.kind, clip: selected.clip }) as TimelineClipSnapshot;
}

export function findTimelineClip(node: DialogueNode, clipId: string): TimelineClipSelection | undefined {
  if (node.dialogue?.id === clipId) return { kind: "dialogue", clip: node.dialogue };
  if (node.select?.id === clipId) return { kind: "select", clip: node.select };
  if (node.focusPush?.id === clipId) return { kind: "focusPush", clip: node.focusPush };
  for (const line of node.lines) {
    const clip = line.clips.find(clip => clip.id === clipId);
    if (clip) return { kind: "performance", line, clip };
  }
}

export function timelinePasteHint(node: DialogueNode, lane: TimelineLane, snapshot: TimelineClipSnapshot | undefined) {
  if (!snapshot) return "请先复制 Clip";
  if (lane.kind === "performance") {
    const line = node.lines.find(line => line.id === lane.lineId);
    if (!line) return "轨道已删除";
    if (snapshot.kind !== "performance" || snapshot.clip.type !== line.type) return "只能粘贴相同类型的 Clip";
  } else {
    if (snapshot.kind !== lane.kind) return "只能粘贴相同类型的 Clip";
    if (node[lane.kind]) return "此轨道只允许一个 Clip，请先删除已有 Clip";
  }
  return "";
}

export function pasteTimelineClip(node: DialogueNode, lane: TimelineLane, snapshot: TimelineClipSnapshot, startTime: number): TimelineClipSelection | undefined {
  if (!Number.isFinite(startTime) || timelinePasteHint(node, lane, snapshot)) return;
  const copy = clone(snapshot);
  copy.clip.id = id("clip");
  copy.clip.startTime = Math.max(0, startTime);
  if (copy.kind === "select") for (const option of copy.clip.options) option.id = id("option");
  if (copy.kind === "performance") for (const component of copy.clip.components) component.id = id("component");
  if (lane.kind === "performance" && copy.kind === "performance") {
    const line = node.lines.find(line => line.id === lane.lineId)!;
    line.clips.push(copy.clip);
    return { ...copy, line };
  }
  if (copy.kind === "dialogue") { node.dialogue = copy.clip; return copy; }
  if (copy.kind === "select") { node.select = copy.clip; return copy; }
  if (copy.kind === "focusPush") { node.focusPush = copy.clip; return copy; }
}
