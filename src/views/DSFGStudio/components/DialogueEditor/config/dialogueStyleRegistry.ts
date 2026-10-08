import type { DialogueStyleDefinition } from "../types/DialogueNode";
import { systemPresetConfig } from "../../EntityPresetEditor/systemPresetConfig";

export const DEFAULT_DIALOGUE_STYLE_ID = "NOLOC_Default";

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

/** 标题对应 Talker；缺失的自定义样式沿用新建预设默认值。 */
export function dialogueStyleShowsTitle(id: string, styles: readonly DialogueStyleDefinition[] = getDialogueStyles()) {
  return styles.find(style => style.id === id)?.showTitle
    ?? systemPresetConfig.dialogueStyles.presets.find(style => style.value === id)?.showTitle
    ?? systemPresetConfig.dialogueStyles.newItem.showTitle;
}

for (const preset of systemPresetConfig.dialogueStyles.presets) {
  registerDialogueStyle({ id: preset.value, label: preset.label, showTitle: preset.showTitle });
}
