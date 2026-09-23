import type { VariableWorkspace, QxqyParamNode } from "miliastra-variable";

/** Validate the original nodes before library normalization; infer IDs from typed positions, not filenames. */
export function readRuntime<T extends object>(text: string, defaults: T, rootId: string, workspace: VariableWorkspace) {
  const raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  const replacements = new Map<string, string>();
  const fail = (path: string, message: string): never => { throw new Error(`${path}：${message}`); };
  const object = (value: any, path: string) => { if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "需要对象"); return value; };
  const list = (value: any, path: string) => { if (!Array.isArray(value) || value.length > 100) fail(path, "需要最多 100 项的列表"); return value as any[]; };
  function id(expected: string, actual: unknown, path: string) {
    if (typeof actual !== "string" || !/^\d+$/.test(actual)) fail(path, "无效结构体 ID");
    if (replacements.has(expected) && replacements.get(expected) !== actual) fail(path, "同一结构体的 ID 不一致");
    replacements.set(expected, actual as string);
  }
  function scalar(type: string, value: any, path: string): any {
    if (typeof value !== "string") fail(path, `${type} 必须使用字符串值`);
    if (type === "String") return value;
    if (type === "Bool") { if (value !== "True" && value !== "False") fail(path, "无效布尔值"); return value === "True"; }
    if (type === "Vector3") {
      const parts = value.split(","); if (parts.length !== 3) fail(path, "无效 Vector3");
      parts.forEach((part: string) => scalar("Float", part.trim(), path)); return value;
    }
    if (type === "Float") { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) fail(path, "无效有限数值"); return value; }
    if (!/^[+-]?\d+$/.test(value)) fail(path, `无效 ${type}`);
    if (type === "Int32" && (Number(value) < -2147483648 || Number(value) > 2147483647)) fail(path, "超出 Int32 范围");
    return value;
  }
  function struct(value: any, expectedId: string, path: string): any {
    object(value, path); id(expectedId, value.structId, path);
    const definition = workspace.getDefinition(expectedId);
    if (!definition || value.type !== "Struct" || !Array.isArray(value.value) || value.value.length !== definition.value.length) fail(path, "结构体字段数量或类型不匹配，请使用当前版本的运行时配置");
    return Object.fromEntries(definition!.value.map((field, index) => [field.key, node(value.value[index], field.value, `${path}.${field.key}`)]));
  }
  function node(value: any, expected: QxqyParamNode, path: string): any {
    object(value, path);
    if (value.param_type !== expected.param_type) fail(path, `需要 ${expected.param_type}，实际为 ${value.param_type}`);
    const type = expected.param_type, schema = expected.value as any;
    if (type === "Struct") return struct(value.value, schema.structId, path);
    if (type === "StructList") {
      object(value.value, path); id(schema.structId, value.value.structId, path);
      return list(value.value.value, path).map((item, i) => node(item, { param_type: "Struct", value: { structId: schema.structId } }, `${path}[${i}]`));
    }
    if (type === "Dict") {
      const dict = object(value.value, path);
      if (dict.type !== "Dict" || dict.key_type !== schema.key_type || dict.value_type !== schema.value_type) fail(path, "字典键值类型不匹配");
      if (schema.value_structId) id(schema.value_structId, dict.value_structId, path);
      const seen = new Set<string>();
      return list(dict.value, path).map((entry, index) => {
        object(entry, path);
        const key = node(entry.key, { param_type: schema.key_type, value: "" }, `${path}[${index}].key`);
        const identity = schema.key_type === "Int32" ? String(Number(key)) : key;
        if (seen.has(identity)) fail(path, `重复字典键 ${key}`); seen.add(identity);
        return { key, value: node(entry.value, { param_type: schema.value_type, value: { structId: schema.value_structId } }, `${path}[${key}]`) };
      });
    }
    if (type.endsWith("List")) return list(value.value, path).map((item, i) => scalar(type.slice(0, -4), item, `${path}[${i}]`));
    return scalar(type, value.value, path);
  }
  const data = struct(raw, rootId, "配置");
  const ids = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, replacements.get(value) ?? value])) as T;
  const used = [...replacements.values()].map(value => value.replace(/^0+(?=\d)/, ""));
  if (new Set(used).size !== used.length) fail("配置", "不同结构体不能共用同一个 ID");
  return { data, ids };
}

export function assertImport(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Preserve full inner keys and reject misplaced buckets rather than silently reindexing. */
export function keyedRows(entries: any[], bucket?: number): any[] {
  return entries.map(entry => {
    assertImport(Number(entry.key) === Number(entry.value.id), `字典键 ${entry.key} 与自身 ID ${entry.value.id} 不一致`);
    if (bucket !== undefined) assertImport(Math.floor(Number(entry.key) / 100) === bucket, `ID ${entry.key} 不属于桶 ${bucket}`);
    return entry.value;
  });
}
