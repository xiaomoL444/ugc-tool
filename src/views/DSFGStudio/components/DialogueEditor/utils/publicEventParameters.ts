import type { PublicEventParamType, PublicEventPreset, PublicEventVisibilityRule } from "../../EntityPresetEditor/publicEventPresets";
import type { PerformanceClip } from "../types/DialogueNode";
import { createClipComponent } from "../config/clipComponentRegistry";
export interface PublicEventArgument { id: string; name: string; type: PublicEventParamType; value: string; reference?: string; visibleWhen?: PublicEventVisibilityRule[] }
export function isPublicEventArgumentVisible(parameter: PublicEventArgument, parameters: PublicEventArgument[]): boolean {
  const rules = parameter.visibleWhen;
  if (!rules?.length) return true;
  // 缺失或损坏的条件保持显示，避免隐藏需要修正的数据。
  if (!Array.isArray(rules) || rules.some(rule => !rule || !parameters.some(item => item?.id === rule.parameterId))) return true;
  return rules.every(rule => {
    const source = parameters.find(item => item.id === rule.parameterId)!;
    return source.type === "Int32"
      ? /^[+-]?\d+$/.test(source.value.trim()) && /^[+-]?\d+$/.test(rule.equals.trim()) && Number(source.value) === Number(rule.equals)
      : source.value === rule.equals;
  });
}
export function getPublicEventArguments(clip: PerformanceClip): PublicEventArgument[] {
  const parameters = clip.components.find(item => item.templateId === "public.event")?.properties.parameters;
  return Array.isArray(parameters) ? parameters : [];
}
export function getPublicEventClipLabel(clip: PerformanceClip, presets: PublicEventPreset[]): string {
  const properties = clip.components.find(item => item.templateId === "public.event")?.properties;
  const preset = presets.find(item => item.id === properties?.presetId)
    ?? presets.find(item => item.name === properties?.value);
  if (preset?.alias.trim()) return preset.alias.trim();
  const savedAlias = properties?.presetAlias;
  return typeof savedAlias === "string" && savedAlias.trim() ? savedAlias.trim() : "公共事件";
}
export function applyPublicEventPreset(clip: PerformanceClip, preset: PublicEventPreset) {
  let config = clip.components.find(item => item.templateId === "public.event");
  if (!config) { config = createClipComponent("public.event"); clip.components.push(config); }
  const previous = config.properties.presetId === preset.id ? getPublicEventArguments(clip) : [];
  config.enabled = true;
  config.properties = { ...config.properties, value: preset.name, presetId: preset.id, presetAlias: preset.alias,
    parameters: preset.parameters.map(param => ({ ...(param.visibleWhen ? { visibleWhen: param.visibleWhen.map(rule => ({ ...rule })) } : {}), ...(param.reference ? { reference: param.reference } : {}), id: param.id, name: param.name, type: param.type,
      value: previous.find(item => item.id === param.id && item.type === param.type)?.value ?? param.defaultValue,
    })),
  };
}
export function compilePublicEventArguments(eventName: string, parameters: unknown) {
  const lists = { stringParams: [eventName], intParams: [] as string[], guidParams: [] as string[], configParams: [] as string[], prefabParams: [] as string[], floatParams: [] as string[] };
  const fields = { String: "stringParams", Int32: "intParams", Guid: "guidParams", ConfigReference: "configParams", EntityReference: "prefabParams", Float: "floatParams" } as const;
  if (parameters === undefined) return lists;
  if (!Array.isArray(parameters)) throw new Error("公共事件参数必须是列表。");
  parameters.forEach((parameter, index) => {
    const fail = () => new Error(`公共事件「${eventName}」参数「${parameter?.name || index + 1}」不符合 ${parameter?.type || "未知"} 类型。`);
    if (!parameter || typeof parameter.value !== "string") throw fail();
    const type = parameter.type as PublicEventParamType;
    if (!Object.prototype.hasOwnProperty.call(fields, type)) throw fail();
    let value = isPublicEventArgumentVisible(parameter, parameters) ? parameter.value : type === "String" ? "" : "0";
    if (type !== "String") {
      value = value.trim();
      if (type === "Float") {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)) || !Number.isFinite(Math.fround(Number(value)))) throw fail();
        value = String(Number(value));
      } else if (type === "Int32") {
        if (!/^[+-]?\d+$/.test(value) || !Number.isInteger(Number(value)) || Number(value) < -2147483648 || Number(value) > 2147483647) throw fail();
        value = String(Number(value));
      } else {
        if (!/^\d+$/.test(value)) throw fail();
        // GUID 保留数字文本，不经过 JS Number，避免大整数精度丢失。
        if (type !== "Guid" && (!Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)) throw fail();
      }
    }
    lists[fields[type]].push(value);
  });
  for (const [field, values] of Object.entries(lists)) {
    if (values.length > 100) throw new Error(`公共事件「${eventName}」的 ${field} 最多 100 项（字符串列表包含事件名）。`);
  }
  return lists;
}
