import { reactive, ref } from "vue";
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
export function createImageCatalog(project: string, categoryProject = project) {
  const oss = createOss(project);
  const categoryOss = createOss(categoryProject);
  const imageAssets = reactive<UIImageAsset[]>([]);
  const imageAssetById = reactive(new Map<number, UIImageAsset>());
  const imageCategories = ref<string[]>([]);
  const imageCategoryNames = reactive<Record<string, Record<string, string>>>({});
  const imageCatalogLoading = ref(false);
  const imageCatalogError = ref("");
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

  function loadImageCatalog(refresh = false) {
    if (catalogRequest && (imageCatalogLoading.value || !refresh)) return catalogRequest;
    imageCatalogLoading.value = true;
    imageCatalogError.value = "";
    catalogRequest = (async () => {
      const [catalog, zh, en] = await Promise.allSettled([
        oss.json<ImageCatalog>("data.json"),
        categoryOss.json<Record<string, string>>("i18n", "zh-cn.json"),
        categoryOss.json<Record<string, string>>("i18n", "en-us.json"),
      ] as const);
      if (zh.status === "fulfilled") imageCategoryNames["zh-CN"] = zh.value;
      if (en.status === "fulfilled") imageCategoryNames["en-US"] = en.value;
      if (catalog.status === "rejected") throw catalog.reason;
      const assets = normalizeImageCatalog(catalog.value);
      imageAssets.splice(0, imageAssets.length, ...assets);
      imageAssetById.clear();
      imageAssets.forEach(asset => imageAssetById.set(asset.id, asset));
      const order = ["3", "4", "15", "16", "5", "6", "1", "2", "8", "18", "7", "17", "9", "12"];
      imageCategories.value = [...new Set([...order, ...Object.keys(catalog.value.category)])].filter(key => key in catalog.value.category);
      if (zh.status === "rejected" || en.status === "rejected") {
        imageCatalogError.value = "部分分类名称加载失败，暂时显示分类编号。";
        catalogRequest = undefined;
      }
    })().catch(() => {
      imageCatalogError.value = "图片资源库加载失败，请重试。";
      catalogRequest = undefined;
    }).finally(() => { imageCatalogLoading.value = false; });
    return catalogRequest;
  }

  function imageCategoryLabel(category: string, locale: string) {
    return imageCategoryNames[locale]?.[category] ?? imageCategoryNames["zh-CN"]?.[category] ?? category;
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
  return { imageAssets, imageAssetById, imageCategories, imageCategoryNames, imageCatalogLoading, imageCatalogError, normalizeImageCatalog, loadImageCatalog, imageCategoryLabel, loadSpriteMetadata };
}

export const clientImageCatalog = createImageCatalog("Public/CustomUIImage", "ClientUIAnimationEditor");
export const { imageAssets, imageAssetById, imageCategories, imageCategoryNames, imageCatalogLoading, imageCatalogError, normalizeImageCatalog, loadImageCatalog, imageCategoryLabel, loadSpriteMetadata } = clientImageCatalog;
