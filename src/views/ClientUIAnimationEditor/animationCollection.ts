import { t } from "../../i18n";
import type { UIAnimation, UINode } from "./types";
import { normalizeKeyframeTracks } from "./keyframeTimeline";
import { normalizeTimelineEvents } from "./timelineEvents";

export function normalizeAnimationCollection(value: unknown, nodes: UINode[]): UIAnimation[] {
  if (!Array.isArray(value) || !value.length) throw new Error(t("clientUIAnimationEditor.ui.animations.atLeastOneRequired"));
  const ids = new Set<string>(), names = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(t("clientUIAnimationEditor.ui.animations.invalidData"));
    const saved = item as Record<string, unknown>;
    const name = typeof saved.name === "string" ? saved.name.trim() : "";
    if (typeof saved.id !== "string" || !saved.id || ids.has(saved.id)) throw new Error(t("clientUIAnimationEditor.ui.animations.invalidAnimationId"));
    if (!name || name.length > 80 || /[\x00-\x1f]/.test(name) || names.has(name)) throw new Error(t("clientUIAnimationEditor.ui.animations.invalidOrDuplicateName"));
    if (typeof saved.duration !== "number" || !Number.isFinite(saved.duration) || saved.duration <= 0) throw new Error(t("clientUIAnimationEditor.ui.animations.invalidDuration", { name: name }));
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
