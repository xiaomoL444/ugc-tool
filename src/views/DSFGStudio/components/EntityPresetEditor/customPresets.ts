import { computed } from "vue";
import { PUBLIC_EVENT_PARAM_TYPES, type PublicEventParamType } from "./publicEventPresets";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export interface CustomPresetField { id: string; name: string; type: PublicEventParamType }
export interface CustomPresetRecord { id: string; name: string; values: Record<string, string> }
export interface CustomPresetTable { id: string; name: string; extends?: string; fields: CustomPresetField[]; records: CustomPresetRecord[] }
export const createCustomTable = (): CustomPresetTable => ({ ...structuredClone(systemPresetConfig.customTables.newItem), id: crypto.randomUUID() });
export const createCustomField = (): CustomPresetField => ({ ...systemPresetConfig.customTables.newField, id: crypto.randomUUID() });
export const createCustomRecord = (): CustomPresetRecord => ({ ...structuredClone(systemPresetConfig.customTables.newRecord), id: crypto.randomUUID() });
export const encodeCustomPresets = (presets: CustomPresetTable[]) => JSON.stringify({ kind: "DSFGCustomPresets", schemaVersion: 1, presets }, null, 2);
export function decodeCustomPresets(raw: string): CustomPresetTable[] {
  const data = JSON.parse(raw);
  const fail = () => { throw new Error("自定义配置数据不完整，原文件已保留。"); };
  if (data?.kind !== "DSFGCustomPresets" || data.schemaVersion !== 1 || !Array.isArray(data.presets)) fail();
  function unique(items: any[]) {
    if (!Array.isArray(items)) fail();
    const ids = new Set<string>();
    for (const item of items) {
      if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string") fail();
      ids.add(item.id);
    }
  }
  unique(data.presets);
  const targets = new Set<string>();
  for (const table of data.presets) {
    if (table.extends !== undefined) {
      if (typeof table.extends !== "string" || !table.extends || targets.has(table.extends) || table.extends === table.id) fail();
      targets.add(table.extends);
    }
    unique(table.fields); unique(table.records);
    for (const field of table.fields) if (!PUBLIC_EVENT_PARAM_TYPES.some(type => type.value === field.type)) fail();
    for (const row of table.records) {
      if (!row.values || typeof row.values !== "object" || Array.isArray(row.values) || Object.values(row.values).some(value => typeof value !== "string")) fail();
    }
  }
  return data.presets;
}
export function mergeCustomPresets(system: readonly CustomPresetTable[], custom: CustomPresetTable[]): CustomPresetTable[] {
  return [...system.map(table => {
    const extension = custom.find(item => item.extends === table.id);
    if (!extension) return table;
    const fields = extension.fields.filter(field => !table.fields.some(base => base.id === field.id));
    const fieldIds = new Set(fields.map(field => field.id));
    return { ...table, fields: [...table.fields, ...fields], records: [
      ...table.records.map(row => {
        const extra = extension.records.find(item => item.id === row.id);
        return { ...row, values: { ...row.values, ...Object.fromEntries(Object.entries(extra?.values ?? {}).filter(([id]) => fieldIds.has(id))) } };
      }),
      ...extension.records.filter(row => !table.records.some(base => base.id === row.id)),
    ] };
  }), ...custom.filter(table => !table.extends || !system.some(base => base.id === table.extends)).map(table => table.extends ? { ...table, id: table.extends } : table)];
}
export function useCustomPresets() {
  const state = useWorkspacePresets({ fileName: "CustomPresets.json", defaults: () => systemPresetConfig.customTables.presets, encode: encodeCustomPresets, decode: decodeCustomPresets });
  return { ...state, availablePresets: computed(() => mergeCustomPresets(state.systemPresets.value, state.presets.value)) };
}
