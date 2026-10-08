import { systemPresetConfig } from "./systemPresetConfig";

export interface EntityPreset {
  id: string;
  /** 网页显示代号，不写入对话的 Talker。 */
  name: string;
  talker: string;
  subtitle: string;
  /** GUID 以文本保存，避免大整数精度丢失。 */
  guid: string;
  entityQuery: string;
}

export function createEntityPreset(): EntityPreset {
  return { ...systemPresetConfig.entities.newItem, id: crypto.randomUUID() };
}

export function getEntityPresetValueOptions(presets: readonly EntityPreset[], field: "guid" | "entityQuery") {
  const seen = new Set<string>();
  return presets.flatMap(preset => {
    const value = preset[field];
    if ((field === "guid" ? !/^\d+$/.test(value) : !value.trim()) || seen.has(value)) return [];
    seen.add(value);
    return [{ label: `${preset.name || preset.talker || "未命名实体"} · ${value}`, value }];
  });
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
      || (item.name !== undefined && typeof item.name !== "string")
      || (item.guid !== undefined && typeof item.guid !== "string")
      || (item.entityQuery !== undefined && typeof item.entityQuery !== "string")) {
      throw new Error("预设实体数据不完整，原文件已保留。");
    }
    ids.add(item.id);
    const defaults = systemPresetConfig.entities.presets.find(preset => preset.id === item.id)
      ?? systemPresetConfig.entities.newItem;
    return { id: item.id, name: item.name ?? item.talker, talker: item.talker, subtitle: item.subtitle,
      guid: item.guid ?? defaults.guid, entityQuery: item.entityQuery ?? defaults.entityQuery };
  });
}
