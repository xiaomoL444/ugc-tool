import type { EffectItem } from "./types/EffectData";

/** Resource keys are explicit within this tool's namespace; legacy labels are plain text. */
export function isEffectResourceKey(value: unknown): value is string {
  return typeof value === "string" && /^effectPlayer(?:\.[\p{L}\p{N}_-]+)+$/u.test(value);
}

export function effectNameKey(item: Pick<EffectItem, "id" | "title" | "name" | "nameI18nKey">): string {
  if (isEffectResourceKey(item.nameI18nKey)) return item.nameI18nKey;
  // The deployed index still uses names.<ID>, while OSS catalogs now use data.<ID>.
  const normalizeNameKey = (key: string) => key.replace(/^effectPlayer\.names\./, "effectPlayer.data.");
  if (isEffectResourceKey(item.title)) return normalizeNameKey(item.title);
  if (isEffectResourceKey(item.name)) return normalizeNameKey(item.name);
  return `effectPlayer.data.${item.id}`;
}

export function effectTagKey(tagId: string | number, label?: string): string {
  return isEffectResourceKey(label) ? label : `effectPlayer.tags.${tagId}`;
}
