import { computed } from "vue";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";
import { cloneStyleParameters, decodeStyleParameters, type StyleParameter } from "./styleParameters";
export type { StyleParameter } from "./styleParameters";

export type StylePresetCategory = "dialogueStyles" | "selectStyles" | "questStyles" | "walkTalkStyles" | "cameras" | "entityGetMethods" | "movementMethods";
export interface StylePreset { id: string; label: string; value: string; showTitle?: boolean; parameters?: StyleParameter[] }
export const stylePresetCategories: { key: StylePresetCategory; title: string }[] = [
  { key: "dialogueStyles", title: "对话类型" },
  { key: "selectStyles", title: "选项卡样式" },
  { key: "questStyles", title: "任务样式" },
  { key: "walkTalkStyles", title: "边走边说类型" },
  { key: "cameras", title: "相机" },
  { key: "entityGetMethods", title: "实体获取方式" },
  { key: "movementMethods", title: "移动方式" },
];

export function supportsCustomStylePresets(category: StylePresetCategory) {
  return category !== "entityGetMethods";
}

export function supportsEditableSystemStylePresets(category: StylePresetCategory) {
  return supportsCustomStylePresets(category) && category !== "movementMethods";
}

export function getStylePresetValueType(category: StylePresetCategory): "Int32" | "String" {
  return category === "entityGetMethods" || category === "movementMethods" ? "Int32" : "String";
}

export function supportsStyleParameters(category: StylePresetCategory) {
  return category === "dialogueStyles" || category === "selectStyles";
}

export function createStyleParameter(): StyleParameter {
  return { ...systemPresetConfig.styleParameters.newParameter, id: crypto.randomUUID() };
}

export function createStylePreset(category: StylePresetCategory): StylePreset {
  return { ...structuredClone(systemPresetConfig[category].newItem), id: crypto.randomUUID() };
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
  const occupiedIds = new Set(data.presets.map((item: StylePreset) => item?.id));
  return data.presets.map((item: StylePreset) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.label !== "string" || typeof item.value !== "string") throw new Error("类型预设数据不完整，原文件已保留。");
    ids.add(item.id);
    const parameters = supportsStyleParameters(category)
      ? decodeStyleParameters(item.parameters === undefined ? [] : item.parameters) : undefined;
    if (category === "dialogueStyles") {
      if (item.showTitle !== undefined && typeof item.showTitle !== "boolean") throw new Error("对话类型的显示标题设置必须为布尔值，原文件已保留。");
      const defaultShowTitle = systemPresetConfig.dialogueStyles.presets.find(preset => preset.value === item.value)?.showTitle
        ?? systemPresetConfig.dialogueStyles.newItem.showTitle;
      return { id: item.id, label: item.label, value: item.value, showTitle: item.showTitle ?? defaultShowTitle, parameters };
    }
    if (category === "selectStyles") {
      let id = item.id;
      const system = systemPresetConfig.selectStyles.presets.find(preset => preset.id === id);
      // Before parameter editing, system option styles were immutable and edited
      // snapshots became custom rows. Keep their old style IDs and labels intact.
      if (data.presetStorage !== "system-overrides" && system
        && (system.value !== item.value || system.label !== item.label)) {
        id = `custom:${item.id}`;
        while (occupiedIds.has(id)) id += ":copy";
        occupiedIds.add(id);
      }
      return { id, label: item.label, value: item.value, parameters };
    }
    return { id: item.id, label: item.label, value: item.value };
  });
}
export function getStylePresetOptions(presets: StylePreset[]) {
  const seen = new Set<string>();
  return presets.filter(item => {
    if (!item.value.trim() || seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  }).map(item => ({ id: item.value, value: item.value, label: item.label.trim() || item.value,
    ...(typeof item.showTitle === "boolean" ? { showTitle: item.showTitle } : {}),
    ...(item.parameters ? { parameters: cloneStyleParameters(item.parameters) } : {}) }));
}
export function useStylePresets(category: StylePresetCategory) {
  const state = useWorkspacePresets<StylePreset>({
    fileName: `${category}.json`, defaults: () => systemPresetConfig[category].presets,
    editableDefaults: supportsEditableSystemStylePresets(category),
    fixedFields: category === "selectStyles" ? ["label", "value"] : ["label"],
    encode: (presets: StylePreset[]) => encodeStylePresets(category, presets),
    decode: (raw: string) => decodeStylePresets(category, raw),
  });
  const availablePresets = computed(() => supportsCustomStylePresets(category)
    ? state.availablePresets.value : [...state.systemPresets.value]);
  return { ...state, availablePresets, options: computed(() => getStylePresetOptions(availablePresets.value)) };
}
