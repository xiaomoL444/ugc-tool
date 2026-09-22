import { systemPresetConfig } from "./systemPresetConfig";
export const PUBLIC_EVENT_PARAM_TYPES = [
  { value: "String", label: "字符串" }, { value: "Int32", label: "整数" },
  { value: "Float", label: "浮点数" },
  { value: "ConfigReference", label: "配置 ID" }, { value: "EntityReference", label: "元件 ID" },
  { value: "Guid", label: "GUID" },
] as const;
export type PublicEventParamType = typeof PUBLIC_EVENT_PARAM_TYPES[number]["value"];
export interface PublicEventVisibilityRule { parameterId: string; equals: string }
export interface PublicEventParameter { id: string; name: string; type: PublicEventParamType; defaultValue: string; reference?: string; visibleWhen?: PublicEventVisibilityRule[] }
export interface PublicEventPreset { id: string; alias: string; name: string; parameters: PublicEventParameter[] }
export function publicEventPresetLabel(preset: PublicEventPreset): string {
  const alias = preset.alias.trim();
  return alias && alias !== preset.name ? `${alias} · ${preset.name}` : preset.name;
}
export function createPublicEventPreset(): PublicEventPreset {
  return { ...structuredClone(systemPresetConfig.publicEvents.newItem), id: crypto.randomUUID() };
}
export function createPublicEventParameter(): PublicEventParameter {
  return { ...systemPresetConfig.publicEvents.newParameter, id: crypto.randomUUID() };
}
export function encodePublicEventPresets(presets: PublicEventPreset[]): string {
  return JSON.stringify({ kind: "DSFGPublicEventPresets", schemaVersion: 2, presets }, null, 2);
}
export function decodePublicEventPresets(raw: string): PublicEventPreset[] {
  const data = JSON.parse(raw);
  const invalid = () => new Error("公共事件预设数据不完整，原文件已保留。");
  if (data?.kind !== "DSFGPublicEventPresets" || ![1, 2].includes(data.schemaVersion) || !Array.isArray(data.presets)) throw invalid();
  const ids = new Set<string>();
  return data.presets.map((item: any) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string") throw invalid();
    ids.add(item.id);
    if (item.alias !== undefined && typeof item.alias !== "string") throw invalid();
    let parameters = item.parameters;
    if (parameters === undefined) {
      if (item.parameter !== undefined && typeof item.parameter !== "string") throw invalid();
      parameters = typeof item.parameter === "string" && item.parameter !== ""
        ? [{ ...systemPresetConfig.publicEvents.newParameter, id: item.id + ":legacy", name: "参数", defaultValue: item.parameter }]
        : [];
    }
    if (!Array.isArray(parameters)) throw invalid();
    const paramIds = new Set<string>();
    return { id: item.id, alias: item.alias ?? item.name, name: item.name, parameters: parameters.map((param: any) => {
      if (!param || typeof param.id !== "string" || !param.id || paramIds.has(param.id) || typeof param.name !== "string" ||
          !PUBLIC_EVENT_PARAM_TYPES.some(type => type.value === param.type) || (param.defaultValue !== undefined && typeof param.defaultValue !== "string")) throw invalid();
      if (param.reference !== undefined && typeof param.reference !== "string") throw invalid();
      if (param.visibleWhen !== undefined && (!Array.isArray(param.visibleWhen) || param.visibleWhen.some((rule: any) => !rule || typeof rule.parameterId !== "string" || typeof rule.equals !== "string"))) throw invalid();
      paramIds.add(param.id);
      return { ...(param.visibleWhen ? { visibleWhen: param.visibleWhen.map((rule: PublicEventVisibilityRule) => ({ parameterId: rule.parameterId, equals: rule.equals })) } : {}), ...(param.reference ? { reference: param.reference } : {}), id: param.id, name: param.name, type: param.type, defaultValue: param.defaultValue ?? systemPresetConfig.publicEvents.newParameter.defaultValue };
    }) };
  });
}
