import { computed } from "vue";
import type { CustomPresetTable } from "./customPresets";
import { useCustomPresets } from "./customPresets";
import { useEntityPresets } from "./useEntityPresets";
import { useSkillAnimationPresets } from "./useSkillAnimationPresets";
import { usePublicEventPresets } from "./usePublicEventPresets";
import { stylePresetCategories, useStylePresets } from "./stylePresets";
import type { PublicEventParamType } from "./publicEventPresets";
import { publicEventPresetLabel } from "./publicEventPresets";

export interface PresetReference { value: string; label: string; type: PublicEventParamType }
export function referenceSources(tables: CustomPresetTable[]): PresetReference[] {
  return [
    { value: "skillAnimations.configId", label: "技能动画 / 配置 ID", type: "ConfigReference" },
    { value: "entities.talker", label: "实体 / 人名", type: "String" },
    { value: "entities.subtitle", label: "实体 / 副标题", type: "String" },
    { value: "publicEvents.name", label: "公共事件 / 事件名", type: "String" },
    ...stylePresetCategories.map(category => ({ value: `${category.key}.value`, label: `${category.title} / 值`, type: category.key === "booleans" || category.key === "entityGetMethods" ? "Int32" as const : "String" as const })),
    ...tables.flatMap(table => table.fields.map(field => ({ value: `custom:${encodeURIComponent(table.id)}:${encodeURIComponent(field.id)}`, label: `${table.name || "未命名配置"} / ${field.name || "未命名字段"}`, type: field.type }))),
  ];
}
export function compatibleReference(source: PresetReference, type: PublicEventParamType) {
  return source.type === type || (source.type === "ConfigReference" && type === "Int32");
}
export function usePresetReferences() {
  const custom = useCustomPresets();
  const entities = useEntityPresets();
  const skills = useSkillAnimationPresets();
  const events = usePublicEventPresets();
  const styles = stylePresetCategories.map(category => ({ key: category.key, state: useStylePresets(category.key) }));
  const states = [custom, entities, skills, events, ...styles.map(item => item.state)];
  function stateFor(reference: string) {
    if (reference.startsWith("custom:")) return custom;
    if (reference.startsWith("entities.")) return entities;
    if (reference.startsWith("skillAnimations.")) return skills;
    if (reference.startsWith("publicEvents.")) return events;
    return styles.find(item => reference === item.key + ".value")?.state;
  }
  const sources = computed(() => referenceSources(custom.availablePresets.value));
  function options(reference: string, type: PublicEventParamType) {
    const source = sources.value.find(item => item.value === reference && compatibleReference(item, type));
    if (!source) return [];
    let values: { label: string; value: string }[] = [];
    if (reference.startsWith("custom:")) {
      let tableId: string, fieldId: string;
      try { [, tableId, fieldId] = reference.split(":").map(decodeURIComponent); } catch { return []; }
      values = custom.availablePresets.value.find(table => table.id === tableId)?.records
        .filter(row => typeof row.values[fieldId] === "string")
        .map(row => ({ label: `${row.name || "未命名记录"} · ${row.values[fieldId]}`, value: row.values[fieldId] })) ?? [];
    } else if (reference === "skillAnimations.configId") values = skills.availablePresets.value.map(row => ({ label: `${row.name} · ${row.configId}`, value: row.configId }));
    else if (reference === "publicEvents.name") values = events.availablePresets.value.map(row => ({ label: publicEventPresetLabel(row), value: row.name }));
    else if (reference.startsWith("entities.")) values = entities.availablePresets.value.map(row => ({ label: row.name || row.talker, value: reference.endsWith("talker") ? row.talker : row.subtitle }));
    else values = styles.find(item => reference === `${item.key}.value`)?.state.availablePresets.value.map(row => ({ label: row.label || row.value, value: row.value })) ?? [];
    // Multiple records may intentionally expose the same value; Select values must be unique.
    return values.filter((item, index) => (reference !== "booleans.value" || item.value === "0" || item.value === "1")
      && (reference !== "entityGetMethods.value" || (/^[+-]?\d+$/.test(item.value) && Number(item.value) >= -2147483648 && Number(item.value) <= 2147483647))
      && values.findIndex(other => other.value === item.value) === index);
  }
  return { sources, options, readyFor: (reference: string) => stateFor(reference)?.ready.value ?? true, errorFor: (reference: string) => stateFor(reference)?.error.value ?? "", retryFor: (reference: string) => stateFor(reference)?.retry() ?? Promise.resolve(), ready: computed(() => states.every(state => state.ready.value)), error: computed(() => states.map(state => state.error.value).filter(Boolean).join("；")), retry: () => Promise.all(states.map(state => state.retry())) };
}
