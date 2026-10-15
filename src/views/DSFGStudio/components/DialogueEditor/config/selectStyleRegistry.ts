import type { SelectStyleDefinition } from "../types/DialogueNode";
import { systemPresetConfig } from "../../EntityPresetEditor/systemPresetConfig";

export const DEFAULT_SELECT_STYLE_ID = "Default_UI";
export const DEFAULT_SELECT_ICON_ID = 100160;

const definitions = new Map<string, SelectStyleDefinition>();

/** 静态注册供独立组件兼容；工作区编辑器从预设设置读取候选，节点只保存样式 ID。 */
export function registerSelectStyle(definition: SelectStyleDefinition) {
  definitions.set(definition.id, definition);
}

export function getSelectStyle(id: string) {
  return definitions.get(id);
}

export function getSelectStyles() {
  return [...definitions.values()];
}

for (const preset of systemPresetConfig.selectStyles.presets) {
  registerSelectStyle({ id: preset.value, label: preset.label, parameters: preset.parameters });
}
