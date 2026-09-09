import type { SelectStyleDefinition } from "../types/DialogueNode";

export const DEFAULT_SELECT_STYLE_ID = "Default_UI";

const definitions = new Map<string, SelectStyleDefinition>();

/** Select 样式与 Dialogue 样式独立注册。 */
export function registerSelectStyle(definition: SelectStyleDefinition) {
  definitions.set(definition.id, definition);
}

export function getSelectStyle(id: string) {
  return definitions.get(id);
}

export function getSelectStyles() {
  return [...definitions.values()];
}

registerSelectStyle({
  id: DEFAULT_SELECT_STYLE_ID,
  label: "默认样式",
});
