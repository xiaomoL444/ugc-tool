import { computed, reactive, ref } from "vue";

import { i18n, t, loadOssTranslations } from "../../i18n";
import { defaultLocale, normalizeAppLocale, type AppLocale } from "../../i18n/preferences";
import { useOssTranslations } from "../../i18n/useOssTranslations";
import type { RemoteTranslationResult } from "../../i18n/remote";
import { createOss } from "../../utils/oss";
import { parseSpriteMetadata, type SpriteMetadata } from "./spriteGeometry";

export interface UIImageAsset {
  id: number;
  src: string;
  borderPath: string;
  categories: string[];
  metadata?: SpriteMetadata;
  missing?: boolean;
}
export interface ImageCatalog {
  imageData: Record<string, { id: number; img: string; border: string }>;
  category: Record<string, { id: number; images: number[] }>;
}
const imageCategorySources: Record<string, string> = {
  "3": "clientUIAnimationEditor.category.3", "4": "clientUIAnimationEditor.category.4", "15": "clientUIAnimationEditor.category.15", "16": "clientUIAnimationEditor.category.16",
  "5": "clientUIAnimationEditor.category.5", "6": "clientUIAnimationEditor.category.6", "1": "clientUIAnimationEditor.category.1", "2": "clientUIAnimationEditor.category.2",
  "8": "clientUIAnimationEditor.category.8", "18": "clientUIAnimationEditor.category.18", "7": "clientUIAnimationEditor.category.7", "17": "clientUIAnimationEditor.category.17", "9": "clientUIAnimationEditor.category.9", "12": "clientUIAnimationEditor.category.12",
};
export function createImageCatalog(project: string, categoryProject = project) {
  const oss = createOss(project);
  const imageAssets = reactive<UIImageAsset[]>([]);
  const imageAssetById = reactive(new Map<number, UIImageAsset>());
  const imageCategories = ref<string[]>([]);
  const imageCatalogLoading = ref(false);
  const catalogFailed = ref(false);
  const categoryFailures = reactive(new Set<string>());
  const imageCatalogError = computed<string>(() => catalogFailed.value
    ? t("clientUIAnimationEditor.ui.images.libraryLoadFailed")
    : categoryFailures.has(i18n.global.locale.value)
      ? t("clientUIAnimationEditor.ui.imageLibrary.categoryLoadPartial")
      : "");
  let catalogRequest: Promise<void> | undefined;
  const metadataRequests = new Map<number, Promise<SpriteMetadata | undefined>>();

  function normalizeImageCatalog(data: ImageCatalog): UIImageAsset[] {
    const entries = new Map<number, UIImageAsset>();
    for (const item of Object.values(data.imageData)) {
      entries.set(item.id, { id: item.id, src: item.img ? oss.path(item.img) : "", borderPath: item.border, categories: [] });
    }
    for (const [category, group] of Object.entries(data.category)) {
      for (const id of group.images) {
        // Keep category entries even when the sprite data is absent.
        if (!entries.has(id)) entries.set(id, { id, src: "", borderPath: "", categories: [] });
        entries.get(id)!.categories.push(category);
      }
    }
    return [...entries.values()];
  }

  function updateCategoryResults(results: RemoteTranslationResult[], locale: AppLocale) {
    if (results.some(result => result.status !== "loaded")) categoryFailures.add(locale);
    else categoryFailures.delete(locale);
  }

  /** Subscribe within a component scope; the public i18n hook owns language changes. */
  function useImageCatalogTranslations() {
    return useOssTranslations(categoryProject, "clientUIAnimationEditor", "i18n", (results, locale) => {
      updateCategoryResults(results, locale);
    }, { keyPrefix: "category" });
  }

  async function loadImageCategoryNames(locale: string, refresh = false): Promise<void> {
    const language = normalizeAppLocale(locale) ?? defaultLocale;
    const results = await loadOssTranslations(categoryProject, "clientUIAnimationEditor", "i18n", {
      locale: language, refresh, keyPrefix: "category",
    });
    updateCategoryResults(results, language);
  }

  function loadImageCatalog(refresh = false, locale: string = i18n.global.locale.value) {
    const translations = loadImageCategoryNames(locale, refresh);
    if (catalogRequest && imageCatalogLoading.value) return catalogRequest;
    if (catalogRequest && !refresh) return translations;
    imageCatalogLoading.value = true;
    catalogFailed.value = false;
    catalogRequest = (async () => {
      const [catalog] = await Promise.allSettled([
        oss.json<ImageCatalog>("data.json"),
        translations,
      ] as const);
      if (catalog.status === "rejected") throw catalog.reason;
      const assets = normalizeImageCatalog(catalog.value);
      imageAssets.splice(0, imageAssets.length, ...assets);
      imageAssetById.clear();
      imageAssets.forEach((asset: UIImageAsset) => imageAssetById.set(asset.id, asset));
      const order = ["3", "4", "15", "16", "5", "6", "1", "2", "8", "18", "7", "17", "9", "12"];
      const category = catalog.value.category;
      imageCategories.value = [...new Set([...order, ...Object.keys(category)])].filter(key => key in category);
    })().catch(() => {
      catalogFailed.value = true;
      catalogRequest = undefined;
    }).finally(() => { imageCatalogLoading.value = false; });
    return catalogRequest;
  }

  function imageCategoryLabel(category: string, locale: string) {
    const key = imageCategorySources[category] ?? `clientUIAnimationEditor.category.${category}`;
    const language = normalizeAppLocale(locale);
    return language && i18n.global.te(key, language) ? t(key, {}, { locale: language }) : key;
  }

  function loadSpriteMetadata(asset: UIImageAsset): Promise<SpriteMetadata | undefined> {
    if (asset.metadata || !asset.borderPath) return Promise.resolve(asset.metadata);
    const pending = metadataRequests.get(asset.id);
    if (pending) return pending;
    const request = oss.json(asset.borderPath).then(raw => {
      const metadata = parseSpriteMetadata(raw);
      if (metadata) asset.metadata = metadata;
      return metadata;
    }).catch(() => undefined).finally(() => metadataRequests.delete(asset.id));
    metadataRequests.set(asset.id, request);
    return request;
  }
  return { imageAssets, imageAssetById, imageCategories, imageCatalogLoading, imageCatalogError, normalizeImageCatalog, loadImageCatalog, loadImageCategoryNames, useImageCatalogTranslations, imageCategoryLabel, loadSpriteMetadata };
}

export const clientImageCatalog = createImageCatalog("Public/CustomUIImage", "ClientUIAnimationEditor");
export const { imageAssets, imageAssetById, imageCategories, imageCatalogLoading, imageCatalogError, normalizeImageCatalog, loadImageCatalog, loadImageCategoryNames, useImageCatalogTranslations, imageCategoryLabel, loadSpriteMetadata } = clientImageCatalog;
