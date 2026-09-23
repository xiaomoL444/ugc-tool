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

export function getClipListLimits(property: ClipPropertyDefinition, siblings: Record<string, unknown> = {}) {
  const conditional = property.itemLimitsWhen;
  const mode = conditional ? siblings[conditional.key] : undefined;
  const limits = conditional && typeof mode === "string" && Object.prototype.hasOwnProperty.call(conditional.cases, mode)
    ? conditional.cases[mode] : undefined;
  return { min: limits?.min ?? property.minItems ?? 0, max: limits?.max ?? property.maxItems ?? Infinity };
}

export function getClipNestedProperties(property: ClipPropertyDefinition, siblings: Record<string, unknown> = {}) {
  const conditional = property.propertiesWhen;
  const mode = conditional ? siblings[conditional.key] : undefined;
  return conditional && typeof mode === "string" && Object.prototype.hasOwnProperty.call(conditional.cases, mode)
    ? conditional.cases[mode] : property.properties ?? [];
}

/** An explicit mode change applies its Slot limit in the same update. Merely
 * loading an older file does not discard its extra point data. */
export function updateClipStructField(definitions: ClipPropertyDefinition[], source: unknown, key: string, value: unknown) {
  const next = createClipPropertyValues(definitions, { ...(isRecord(source) ? source : {}), [key]: value });
  for (const property of definitions) {
    if (property.type !== "struct-list" || property.itemLimitsWhen?.key !== key) continue;
    const { max } = getClipListLimits(property, next);
    next[property.key] = (next[property.key] as unknown[]).slice(0, max);
    if (property.propertiesWhen?.key === key) {
      const fields = getClipNestedProperties(property, next);
      next[property.key] = (next[property.key] as unknown[]).map(item => {
        const slot = createClipPropertyValues(fields, item);
        for (const field of fields) {
          const originalField = property.properties?.find(original => original.key === field.key);
          if (field.type === "select" && originalField?.options?.some(option => option.value === slot[field.key]) &&
              field.options && !field.options.some(option => option.value === slot[field.key])) {
            slot[field.key] = structuredClone(field.defaultValue);
          }
        }
        return slot;
      });
    }
  }
  return next;
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
      const items = (Array.isArray(value) ? value : []).map((item) =>
        createClipPropertyValues(property.properties ?? [], item),
      );
      const { min } = getClipListLimits(property, result);
      while (items.length < min) items.push(createClipPropertyValues(property.properties ?? []));
      result[property.key] = items;
    } else {
      result[property.key] = value;
    }
  }
  return result;
}
