import { computed, ref } from "vue";
import { i18n, t } from "../../i18n";
import { useOssTranslations } from "../../i18n/useOssTranslations";
import { createOss } from "../../utils/oss";

export type UIVfxScope = "ui" | "screen";
export interface UIVfxAsset {
  id: number;
  nameI18nKey: string;
  category: number;
  scope: UIVfxScope;
  tagList: number[];
  url: string;
  icon: string | null;
  isLoop: boolean;
  width: number;
  height: number;
  audioUrls: string[];
}
export interface UIVfxTag { id: number; nameI18nKey: string }
const oss = createOss("Public/UIVfx");
export const uiVfxAssets = ref<UIVfxAsset[]>([]);
export const uiVfxTags = ref<UIVfxTag[]>([]);
export const uiVfxLoading = ref(false);
export const uiVfxError = ref(false);
export const uiVfxById = computed(() => new Map(uiVfxAssets.value.map(asset => [asset.id, asset])));
let pending: Promise<void> | null = null;
let loaded = false;

function assetUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  // Leading slashes in this catalog are relative to Public/UIVfx, not the host.
  if (/^https?:\/\//i.test(value)) return value;
  if (value.includes(":") || value.includes("..") || value.startsWith("//")) return null;
  return oss.path(value);
}
export function normalizeUIVfxCatalog(input: unknown): { assets: UIVfxAsset[]; tags: UIVfxTag[] } {
  const catalog = input as { data?: unknown; tags?: unknown } | null;
  if (!catalog || !Array.isArray(catalog.data)) throw new Error("Invalid UI VFX catalog");
  const ids = new Set<number>();
  const assets = catalog.data.map((raw): UIVfxAsset => {
    const id = Number(raw.id), url = assetUrl(raw.path);
    if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id) || !url || !["ui", "screen"].includes(raw.scope)
      || !(raw.width > 0) || !Number.isFinite(raw.width) || !(raw.height > 0) || !Number.isFinite(raw.height)
      || typeof raw.isLoop !== "boolean" || typeof raw.nameI18nKey !== "string") throw new Error("Invalid UI VFX asset");
    ids.add(id);
    return { id, nameI18nKey: raw.nameI18nKey, category: Number(raw.category), scope: raw.scope,
      tagList: Array.isArray(raw.tagList) ? raw.tagList.filter(Number.isSafeInteger) : [], url, icon: assetUrl(raw.icon),
      isLoop: raw.isLoop, width: raw.width, height: raw.height,
      audioUrls: raw.hasAudio && Array.isArray(raw.audioPath) ? raw.audioPath.map(assetUrl).filter((url: string | null): url is string => Boolean(url)) : [] };
  });
  const tags = Array.isArray(catalog.tags) ? catalog.tags.filter(tag => Number.isSafeInteger(tag.id) && typeof tag.nameI18nKey === "string") : [];
  return { assets, tags };
}
export function loadUIVfxCatalog(refresh = false): Promise<void> {
  if (pending) return pending;
  if (loaded && !refresh) return Promise.resolve();
  uiVfxLoading.value = true; uiVfxError.value = false;
  pending = oss.json("data.json").then(normalizeUIVfxCatalog).then(({ assets, tags }) => {
    uiVfxAssets.value = assets; uiVfxTags.value = tags; loaded = true;
  }).catch(() => { uiVfxError.value = true; }).finally(() => { uiVfxLoading.value = false; pending = null; });
  return pending;
}
export function useUIVfxTranslations() { return useOssTranslations("Public/UIVfx", "uiEffect"); }
export function uiVfxLabel(asset: UIVfxAsset) {
  return i18n.global.te(asset.nameI18nKey) ? t(asset.nameI18nKey) : `#${asset.id}`;
}
export function uiVfxTagLabel(tag: UIVfxTag) {
  return i18n.global.te(tag.nameI18nKey) ? t(tag.nameI18nKey) : `#${tag.id}`;
}

/** Match the editor's full ancestry, including activation independently of visibility. */
export function isUIVfxEnabled(id: string, nodes: ReadonlyArray<{ id: string; parentId: string | null; active: boolean; visible: boolean }>): boolean {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set<string>();
  let node = byId.get(id);
  if (!node) return false;
  while (node) {
    if (visited.has(node.id) || !node.active || !node.visible) return false;
    visited.add(node.id);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return true;
}
