import type { PublicEventParamType } from "./EntityPresetEditor/publicEventPresets";

/** 允许正常输入数值的中间状态；整段非法输入不拆删，避免把 1.5 改成 15。 */
export function isTypedValueDraft(type: PublicEventParamType, value: string): boolean {
  if (type === "String") return true;
  if (type === "Int32") return /^[+-]?\d*$/.test(value);
  if (type === "Float") {
    return /^[+-]?\d*(?:\.\d*)?$/.test(value)
      || /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d*$/.test(value);
  }
  return /^\d*$/.test(value);
}

/** 校验而不转换原文本，保留 GUID 精度、草稿和已有数据。空值仍可用于可选字段。 */
export function getTypedValueError(type: PublicEventParamType, value: string): string {
  if (type === "String" || value === "") return "";
  if (type === "Float") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
        || !Number.isFinite(Number(value)) || !Number.isFinite(Math.fround(Number(value)))) {
      return "请输入有效的浮点数，例如 -1.5。";
    }
    return "";
  }
  if (type === "Int32") {
    return /^[+-]?\d+$/.test(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647
      ? "" : "请输入 -2147483648 至 2147483647 范围内的整数。";
  }
  if (!/^\d+$/.test(value)) return "请输入非负整数。";
  if (type !== "Guid" && Number(value) > 2147483647) return "ID 必须是 0 至 2147483647 范围内的整数。";
  return "";
}
