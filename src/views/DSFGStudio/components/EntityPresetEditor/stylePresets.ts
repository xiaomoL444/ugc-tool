import { computed } from "vue";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export type StylePresetCategory = "dialogueStyles" | "questStyles" | "walkTalkStyles" | "cameras" | "booleans" | "entityGetMethods";
export interface StylePreset { id: string; label: string; value: string }
export const stylePresetCategories: { key: StylePresetCategory; title: string }[] = [
  { key: "dialogueStyles", title: "对话类型" },
  { key: "questStyles", title: "任务样式" },
  { key: "walkTalkStyles", title: "边走边说类型" },
  { key: "cameras", title: "相机" },
  { key: "booleans", title: "布尔值" },
  { key: "entityGetMethods", title: "实体获取方式" },
];

export function createStylePreset(category: StylePresetCategory): StylePreset {
  return { ...systemPresetConfig[category].newItem, id: crypto.randomUUID() };
}
export function encodeStylePresets(category: StylePresetCategory, presets: StylePreset[]) {
  return JSON.stringify({ kind: "DSFGStylePresets", schemaVersion: 1, category, presets }, null, 2);
}
export function decodeStylePresets(category: StylePresetCategory, raw: string): StylePreset[] {
  const data = JSON.parse(raw);
  if (data?.kind !== "DSFGStylePresets" || data.schemaVersion !== 1 || data.category !== category || !Array.isArray(data.presets)) {
    throw new Error("无法识别类型预设文件，原文件已保留。");
  }
  const ids = new Set<string>();
  return data.presets.map((item: StylePreset) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.label !== "string" || typeof item.value !== "string") throw new Error("类型预设数据不完整，原文件已保留。");
    ids.add(item.id);
    return { id: item.id, label: item.label, value: item.value };
  });
}
export function getStylePresetOptions(presets: StylePreset[]) {
  const seen = new Set<string>();
  return presets.filter(item => {
    if (!item.value.trim() || seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  }).map(item => ({ id: item.value, value: item.value, label: item.label.trim() || item.value }));
}
export function useStylePresets(category: StylePresetCategory) {
  const state = useWorkspacePresets({
    fileName: `${category}.json`, defaults: () => systemPresetConfig[category].presets,
    encode: (presets: StylePreset[]) => encodeStylePresets(category, presets),
    decode: (raw: string) => decodeStylePresets(category, raw),
  });
  return { ...state, options: computed(() => getStylePresetOptions(state.availablePresets.value)) };
}
