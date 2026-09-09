import type { ClipPropertyDefinition } from "../types/DialogueNode";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isClipPropertyVisible(
  property: ClipPropertyDefinition,
  siblingValues: Record<string, unknown>,
): boolean {
  const condition = property.visibleWhen;
  return !condition || condition.values.some((value) => value === siblingValues[condition.key]);
}

/** 补齐模板默认值，保留用户扩展字段，并为嵌套对象和列表创建独立实例。 */
export function createClipPropertyValues(
  definitions: ClipPropertyDefinition[],
  source?: unknown,
): Record<string, unknown> {
  const values = isRecord(source) ? source : {};
  const result = { ...values };
  for (const property of definitions) {
    const value = values[property.key] === undefined
      ? structuredClone(property.defaultValue)
      : values[property.key];
    if (property.type === "struct") {
      result[property.key] = createClipPropertyValues(property.properties ?? [], value);
    } else if (property.type === "struct-list") {
      result[property.key] = (Array.isArray(value) ? value : []).map((item) =>
        createClipPropertyValues(property.properties ?? [], item),
      );
    } else {
      result[property.key] = value;
    }
  }
  return result;
}
