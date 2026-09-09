import type { DialogueStyleDefinition } from "../types/DialogueNode";

export const DEFAULT_DIALOGUE_STYLE_ID = "Default_UI";

const definitions = new Map<string, DialogueStyleDefinition>();

/** 新增对话 UI 样式时只需注册到这里，节点数据只保存样式 ID。 */
export function registerDialogueStyle(definition: DialogueStyleDefinition) {
  definitions.set(definition.id, definition);
}

export function getDialogueStyle(id: string) {
  return definitions.get(id);
}

export function getDialogueStyles() {
  return [...definitions.values()];
}

registerDialogueStyle({
  id: DEFAULT_DIALOGUE_STYLE_ID,
  label: "默认样式",
});

registerDialogueStyle({
  id: "Black_Screen",
  label: "黑幕对话",
});

registerDialogueStyle({
  id: "Clear",
  label: "清除效果",
});
