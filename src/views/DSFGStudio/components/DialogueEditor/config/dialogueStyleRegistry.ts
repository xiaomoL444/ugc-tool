import type { DialogueStyleDefinition } from "../types/DialogueNode";
import { systemPresetConfig } from "../../EntityPresetEditor/systemPresetConfig";

export const DEFAULT_DIALOGUE_STYLE_ID = "Default_UI";

const definitions = new Map<string, DialogueStyleDefinition>();

/** 静态注册供独立组件兼容；工作区编辑器从预设设置读取候选，节点只保存样式 ID。 */
export function registerDialogueStyle(definition: DialogueStyleDefinition) {
  definitions.set(definition.id, definition);
}

export function getDialogueStyle(id: string) {
  return definitions.get(id);
}

export function getDialogueStyles() {
  return [...definitions.values()];
}

for (const preset of systemPresetConfig.dialogueStyles.presets) {
  registerDialogueStyle({ id: preset.value, label: preset.label });
}
