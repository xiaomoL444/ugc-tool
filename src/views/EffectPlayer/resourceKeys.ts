import type { EffectItem } from "./types/EffectData";

/** Resource keys are explicit within this tool's namespace; legacy labels are plain text. */
export function isEffectResourceKey(value: unknown): value is string {
  return typeof value === "string" && /^effectPlayer(?:\.[\p{L}\p{N}_-]+)+$/u.test(value);
}

export function effectNameKey(item: Pick<EffectItem, "id" | "title" | "name">): string {
  if (isEffectResourceKey(item.title)) return item.title;
  if (isEffectResourceKey(item.name)) return item.name;
  return `effectPlayer.names.${item.id}`;
}

export function effectTagKey(tagId: string | number, label?: string): string {
  return isEffectResourceKey(label) ? label : `effectPlayer.tags.${tagId}`;
}
