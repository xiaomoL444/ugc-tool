import imageAssetConfig from "@/assets/ClientUIAnimationEditor/image-assets.json";

import type { UIImageType } from "./types";

const image100001 = require("@/assets/ClientUIAnimationEditor/UI_UGC_CustomShape_Square.png") as string;
const image100002 = require("@/assets/ClientUIAnimationEditor/UI_UGC_CustomShape_Circle.png") as string;
const image100003 = require("@/assets/ClientUIAnimationEditor/UI_UGC_CustomShape_Triangle.png") as string;
const image100004 = require("@/assets/ClientUIAnimationEditor/UI_UGC_CustomShape_FourPointedStar.png") as string;
const image100005 = require("@/assets/ClientUIAnimationEditor/UI_UGC_CustomShape_FivePointedStar.png") as string;
const image100006 = require("@/assets/ClientUIAnimationEditor/UI_UGC_CustomShape_Ring.png") as string;

export interface UIImageAsset {
  id: number;
  path: string;
  name: string;
  description: string;
  src: string;
  imageType: UIImageType;
  defaultWidth: number;
  defaultHeight: number;
  preserveAspect: boolean;
}

const imageSources: Record<string, string> = {
  "UI_UGC_CustomShape_Square.png": image100001,
  "UI_UGC_CustomShape_Circle.png": image100002,
  "UI_UGC_CustomShape_Triangle.png": image100003,
  "UI_UGC_CustomShape_FourPointedStar.png": image100004,
  "UI_UGC_CustomShape_FivePointedStar.png": image100005,
  "UI_UGC_CustomShape_Ring.png": image100006,
};

export const imageAssets: UIImageAsset[] = imageAssetConfig.map((asset) => ({
  ...asset,
  imageType: (asset.imageType === "default" ? "basic" : asset.imageType) as UIImageType,
  src: imageSources[asset.path],
}));

export const imageAssetById = new Map(imageAssets.map((asset) => [asset.id, asset]));
