import type { BgmDataFile, BgmInfo } from "../types/bgmInfo";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBgmInfo(value: unknown): value is BgmInfo {
  if (!isRecord(value)) return false;
  return ["id", "song_id", "album_id", "time", "minute", "second", "category", "order"].every(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  ) && ["name", "album"].every((key) => typeof value[key] === "string");
}

export function normalizeBgmData(data: unknown): BgmDataFile {
  if (!isRecord(data) || !Array.isArray(data.musicData)) {
    throw new Error("BGM 数据格式错误：musicData 必须是音乐数组");
  }

  const musicData = data.musicData.map((item, index) => {
    if (!isBgmInfo(item)) {
      throw new Error(`BGM 数据格式错误：第 ${index + 1} 首音乐的信息无效`);
    }
    return { item, index };
  });

  const categoryData = data.categoryData;
  if (!isRecord(categoryData) || !Object.values(categoryData).every((name) => typeof name === "string")) {
    throw new Error("BGM 数据格式错误：categoryData 必须是分类名称字典");
  }

  return {
    musicData: musicData
      .sort((a, b) => a.item.order - b.item.order || a.index - b.index)
      .map(({ item }) => item),
    categoryData: { ...categoryData } as Record<string, string>,
  };
}
