import { createImageCatalog } from "@/views/ClientUIAnimationEditor/imageAssets";
import { createOss } from "@/utils/oss";

// 公共图片目录与客户端图库共用分类编号及其翻译。
export const selectIconCatalog = createImageCatalog("Public/CustomUIImage", "ClientUIAnimationEditor");
const oss = createOss("Public/CustomUIImage");
export function selectOptionIconUrl(id: number): string {
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return "";
  const asset = selectIconCatalog.imageAssetById.get(id);
  return asset ? asset.src : oss.path("sprite", `${id}.png`);
}
