import { systemPresetConfig } from "./systemPresetConfig";

export interface EntityPreset {
  id: string;
  /** 网页显示代号，不写入对话的 Talker。 */
  name: string;
  talker: string;
  subtitle: string;
}

export function createEntityPreset(): EntityPreset {
  return { ...systemPresetConfig.entities.newItem, id: crypto.randomUUID() };
}

export function encodeEntityPresets(presets: EntityPreset[]): string {
  return JSON.stringify({ kind: "DSFGEntityPresets", schemaVersion: 1, presets }, null, 2);
}

export function decodeEntityPresets(raw: string): EntityPreset[] {
  const data = JSON.parse(raw);
  if (data?.kind !== "DSFGEntityPresets" || data.schemaVersion !== 1 || !Array.isArray(data.presets)) {
    throw new Error("无法识别预设实体文件，原文件已保留。");
  }
  const ids = new Set<string>();
  return data.presets.map((item: EntityPreset) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.talker !== "string" || typeof item.subtitle !== "string"
      || (item.name !== undefined && typeof item.name !== "string")) {
      throw new Error("预设实体数据不完整，原文件已保留。");
    }
    ids.add(item.id);
    return { id: item.id, name: item.name ?? item.talker, talker: item.talker, subtitle: item.subtitle };
  });
}
