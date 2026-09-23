import type { BgmDataFile, BgmInfo } from "../types/bgmInfo";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resourceKey(value: unknown, kind: string, id: number): string {
  if (value === undefined) return `bgmPlayer.${kind}.${id}`;
  if (typeof value !== "string" || !new RegExp(`^bgmPlayer\\.${kind}\\.[\\p{L}\\p{N}_-]+$`, "u").test(value)
      || ["__proto__", "prototype", "constructor"].includes(value.split(".")[2])) {
    throw new Error(`Invalid BGM ${kind} translation key`);
  }
  return value;
}

/** Standard indexes use data/category arrays; legacy names are never display fallbacks. */
export function normalizeBgmData(source: unknown): BgmDataFile {
  if (!isRecord(source)) throw new Error("Invalid BGM index");
  const standard = Object.prototype.hasOwnProperty.call(source, "data");
  const rows = standard ? source.data : source.musicData;
  if (!Array.isArray(rows)) throw new Error("BGM data must be an array");
  const ids = new Set<number>();
  const data = rows.map((row): BgmInfo => {
    if (!isRecord(row) || !["id", "song_id", "album_id", "time", "minute", "second", "category", "order"]
      .every((key) => typeof row[key] === "number" && Number.isFinite(row[key]))) {
      throw new Error("Invalid BGM song fields");
    }
    const numbers = row as unknown as BgmInfo;
    if (![numbers.id, numbers.song_id, numbers.album_id, numbers.category].every(Number.isSafeInteger)
        || ids.has(numbers.id)) throw new Error("Invalid or duplicate BGM ID");
    ids.add(numbers.id);
    if (standard && (row.nameI18nKey === undefined || row.albumI18nKey === undefined)) {
      throw new Error("BGM translation keys are required");
    }
    return {
      id: numbers.id, song_id: numbers.song_id, album_id: numbers.album_id,
      time: numbers.time, minute: numbers.minute, second: numbers.second,
      category: numbers.category, order: numbers.order,
      ...(typeof row.giVersion === "string" && row.giVersion.trim()
        ? { giVersion: row.giVersion.trim() } : {}),
      nameI18nKey: resourceKey(row.nameI18nKey, "data", numbers.id),
      albumI18nKey: resourceKey(row.albumI18nKey, "album", numbers.album_id),
    };
  }).sort((a, b) => a.order - b.order);

  let categories: unknown[];
  if (standard) {
    if (!Array.isArray(source.category)) throw new Error("BGM category must be an array");
    categories = source.category;
  } else {
    if (!isRecord(source.categoryData) || !Object.values(source.categoryData).every((name) => typeof name === "string")) {
      throw new Error("Invalid BGM categoryData");
    }
    categories = Object.keys(source.categoryData).map((id) => ({ id: Number(id) }));
  }
  const categoryIds = new Set<number>();
  const category = categories.map((row) => {
    if (!isRecord(row) || typeof row.id !== "number" || !Number.isSafeInteger(row.id) || categoryIds.has(row.id)) {
      throw new Error("Invalid or duplicate BGM category ID");
    }
    categoryIds.add(row.id);
    if (standard && row.nameI18nKey === undefined) throw new Error("BGM category translation key is required");
    return { id: row.id, nameI18nKey: resourceKey(row.nameI18nKey, "category", row.id) };
  });
  return { data, category };
}
