/** 对话与选项卡样式按列表顺序传入整数；来源只用于编辑器填写候选。 */
export interface StyleParameter {
  id: string;
  name: string;
  type: "Int32";
  defaultValue: string;
  reference?: string;
}

export interface StyleParameterPreset {
  style: string;
  parameters: StyleParameter[];
}

export function cloneStyleParameters(parameters: readonly StyleParameter[]): StyleParameter[] {
  return parameters.map(parameter => ({ ...parameter }));
}

export function decodeStyleParameters(value: unknown): StyleParameter[] {
  const invalid = () => new Error("样式参数必须包含名称、整数类型与默认值，原文件已保留。");
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  const ids = new Set<string>();
  return value.map(parameter => {
    if (!parameter || typeof parameter.id !== "string" || !parameter.id || ids.has(parameter.id)
      || typeof parameter.name !== "string" || parameter.type !== "Int32"
      || typeof parameter.defaultValue !== "string"
      || (parameter.reference !== undefined && typeof parameter.reference !== "string")) throw invalid();
    ids.add(parameter.id);
    return { id: parameter.id, name: parameter.name, type: "Int32", defaultValue: parameter.defaultValue,
      ...(typeof parameter.reference === "string" ? { reference: parameter.reference } : {}) };
  });
}

/** 无效的旧元数据不阻止读取台词；实际参数草稿仍由 Clip 的数组保留。 */
export function normalizeStyleParameterPreset(value: unknown): StyleParameterPreset | undefined {
  if (!value || typeof value !== "object" || !("style" in value) || typeof value.style !== "string"
    || !("parameters" in value)) return undefined;
  try { return { style: value.style, parameters: decodeStyleParameters(value.parameters) }; }
  catch { return undefined; }
}
