import { systemPresetConfig } from "./systemPresetConfig";

export const SAVE_INTEGER_COUNT = 100;
export const SAVE_BIT_COUNT = SAVE_INTEGER_COUNT * 32;

/** Global, zero-based positions in [0] MSB first, then [1] MSB first, through [99]. */
export interface SaveModuleField {
  id: string;
  name: string;
  startBit: number;
  length: number;
  min: string;
  max: string;
  /** Keep invalid v1 coordinates available for repair without silently moving their data. */
  legacyLocation?: { integerIndex: number; startBit: number; endBit: number };
}

export interface SaveModule {
  id: string;
  name: string;
  fields: SaveModuleField[];
}

export interface SaveModuleIssue { fieldId: string; message: string }
export interface SaveModulesIssue extends SaveModuleIssue { moduleId: string }

export function createSaveModule(): SaveModule {
  return { ...structuredClone(systemPresetConfig.saveModules.newItem), id: crypto.randomUUID() };
}

export function createSaveModuleField(): SaveModuleField {
  return { ...systemPresetConfig.saveModules.newField, id: crypto.randomUUID() };
}

export function encodeSaveModules(presets: SaveModule[]): string {
  // Semantic errors remain valid drafts and are reported by validateSaveModule.
  return JSON.stringify({ kind: "DSFGSaveModules", schemaVersion: 2, presets }, null, 2);
}

export function decodeSaveModules(raw: string): SaveModule[] {
  const fail = (): never => { throw new Error("存档模块数据不完整，原文件已保留。"); };
  let data: any;
  try { data = JSON.parse(raw); } catch { return fail(); }
  if (data?.kind !== "DSFGSaveModules" || ![1, 2].includes(data.schemaVersion) || !Array.isArray(data.presets)) fail();
  const isRecord = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const decodeId = (item: Record<string, unknown>, ids: Set<string>) => {
    if (typeof item.id !== "string" || !item.id.trim() || ids.has(item.id)) fail();
    ids.add(item.id as string);
    return item.id as string;
  };
  const readName = (item: Record<string, unknown>, fallback: string) => {
    if (item.name === undefined) return fallback;
    if (typeof item.name !== "string") fail();
    return item.name as string;
  };
  const readNumber = (item: Record<string, unknown>, key: string, fallback: number): number => {
    if (item[key] === undefined) return fallback;
    if (typeof item[key] !== "number" || !Number.isFinite(item[key])) return fail();
    return item[key] as number;
  };
  const readRange = (item: Record<string, unknown>, key: "min" | "max"): string => {
    const value = item[key];
    if (value === undefined) return systemPresetConfig.saveModules.newField[key];
    if (data.schemaVersion === 2) {
      if (typeof value !== "string") return fail();
      return value;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return fail();
    // Int32 ranges remain exact; invalid fractional/negative drafts remain visible as text.
    return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  };
  const moduleIds = new Set<string>();
  return data.presets.map((item: unknown) => {
    if (!isRecord(item)) return fail();
    const id = decodeId(item, moduleIds);
    const fields = item.fields === undefined ? structuredClone(systemPresetConfig.saveModules.newItem.fields) : item.fields;
    if (!Array.isArray(fields)) return fail();
    const fieldIds = new Set<string>();
    return {
      id,
      name: readName(item, systemPresetConfig.saveModules.newItem.name),
      fields: fields.map((field: unknown): SaveModuleField => {
        if (!isRecord(field)) return fail();
        const result: SaveModuleField = {
          ...systemPresetConfig.saveModules.newField,
          id: decodeId(field, fieldIds),
          name: readName(field, systemPresetConfig.saveModules.newField.name),
          min: readRange(field, "min"),
          max: readRange(field, "max"),
        };
        if (data.schemaVersion === 1) {
          const integerIndex = readNumber(field, "integerIndex", 0);
          const startBit = readNumber(field, "startBit", 0);
          const endBit = readNumber(field, "endBit", 0);
          const valid = Number.isInteger(integerIndex) && integerIndex >= 0 && integerIndex < SAVE_INTEGER_COUNT
            && Number.isInteger(startBit) && Number.isInteger(endBit) && startBit >= 0 && endBit <= 31 && startBit <= endBit;
          if (valid) {
            result.startBit = integerIndex * 32 + (31 - endBit);
            result.length = endBit - startBit + 1;
          } else {
            result.startBit = -1;
            result.length = Number.isInteger(endBit - startBit + 1) && endBit >= startBit ? endBit - startBit + 1 : 1;
            result.legacyLocation = { integerIndex, startBit, endBit };
          }
        } else {
          result.startBit = readNumber(field, "startBit", systemPresetConfig.saveModules.newField.startBit);
          result.length = readNumber(field, "length", systemPresetConfig.saveModules.newField.length);
          if (field.legacyLocation !== undefined) {
            if (!isRecord(field.legacyLocation)) return fail();
            const legacy = field.legacyLocation;
            if (["integerIndex", "startBit", "endBit"].some(key => legacy[key] === undefined)) return fail();
            result.legacyLocation = {
              integerIndex: readNumber(legacy, "integerIndex", 0),
              startBit: readNumber(legacy, "startBit", 0),
              endBit: readNumber(legacy, "endBit", 0),
            };
          }
        }
        return result;
      }),
    };
  });
}

function hasValidBits(field: SaveModuleField): boolean {
  return Number.isInteger(field.startBit) && Number.isInteger(field.length)
    && field.startBit >= 0 && field.startBit < SAVE_BIT_COUNT
    && field.length >= 1 && field.length <= SAVE_BIT_COUNT - field.startBit;
}

function fieldLocationMessages(field: SaveModuleField): string[] {
  return hasValidBits(field) ? [] : [`起始位必须是 0–${SAVE_BIT_COUNT - 1} 内的整数，长度必须为正整数且不能超出 ${SAVE_BIT_COUNT} 位。`];
}

/** Maximum unsigned value representable by this global span, as exact decimal text. */
export function getSaveFieldCapacity(field: SaveModuleField): string {
  return ((1n << BigInt(getSaveFieldBitLength(field))) - 1n).toString();
}

/** Number of source bits in a global field interval, including cross-integer spans. */
export function getSaveFieldBitLength(field: SaveModuleField): number {
  const messages = fieldLocationMessages(field);
  if (messages.length) throw new Error(messages[0]);
  return field.length;
}

function decimalValue(value: unknown): bigint | undefined {
  return typeof value === "string" && value.length > 0 && !/[^0-9]/.test(value) ? BigInt(value) : undefined;
}

function fieldMessages(field: SaveModuleField): string[] {
  const messages = fieldLocationMessages(field);
  const min = decimalValue(field.min), max = decimalValue(field.max);
  if (min === undefined || max === undefined || max < min) {
    messages.push("数值范围必须是非负十进制整数，最小值不能大于最大值。");
  } else if (hasValidBits(field) && max > BigInt(getSaveFieldCapacity(field))) {
    messages.push(`最大值不能超过此位段可存储的 ${getSaveFieldCapacity(field)}。`);
  }
  return messages;
}

function fieldsOverlap(a: SaveModuleField, b: SaveModuleField): boolean {
  return hasValidBits(a) && hasValidBits(b)
    && a.startBit < b.startBit + b.length && b.startBit < a.startBit + a.length;
}

export function validateSaveModule(module: SaveModule): SaveModuleIssue[] {
  const issues: SaveModuleIssue[] = [];
  if (!module.id.trim()) issues.push({ fieldId: "", message: "存档模块 ID 不能为空。" });
  const ids = new Set<string>();
  for (const field of module.fields) {
    if (!field.id.trim()) issues.push({ fieldId: field.id, message: "字段 ID 不能为空。" });
    if (ids.has(field.id)) issues.push({ fieldId: field.id, message: "字段 ID 重复。" });
    ids.add(field.id);
    for (const message of fieldMessages(field)) issues.push({ fieldId: field.id, message });
  }
  for (let left = 0; left < module.fields.length; left++) {
    const a = module.fields[left];
    for (let right = left + 1; right < module.fields.length; right++) {
      const b = module.fields[right];
      if (!fieldsOverlap(a, b)) continue;
      issues.push({ fieldId: a.id, message: `与“${b.name || "未命名字段"}”的全局位范围重叠。` });
      issues.push({ fieldId: b.id, message: `与“${a.name || "未命名字段"}”的全局位范围重叠。` });
    }
  }
  return issues;
}

/** All modules share one concatenated 3200-bit stream, including across integer boundaries. */
export function validateSaveModules(modules: SaveModule[]): SaveModulesIssue[] {
  const issues = modules.flatMap(module => validateSaveModule(module).map(issue => ({ ...issue, moduleId: module.id })));
  const moduleIds = new Set<string>();
  for (const module of modules) {
    if (moduleIds.has(module.id)) issues.push({ moduleId: module.id, fieldId: "", message: "存档模块 ID 重复。" });
    moduleIds.add(module.id);
  }
  for (let left = 0; left < modules.length; left++) {
    const a = modules[left];
    for (let right = left + 1; right < modules.length; right++) {
      const b = modules[right];
      for (const aField of a.fields) {
        for (const bField of b.fields) {
          if (aField.id === bField.id) {
            issues.push({ moduleId: a.id, fieldId: aField.id, message: `与存档模块“${b.name || "未命名模块"}”中的字段 ID 重复。` });
            issues.push({ moduleId: b.id, fieldId: bField.id, message: `与存档模块“${a.name || "未命名模块"}”中的字段 ID 重复。` });
          }
          if (!fieldsOverlap(aField, bField)) continue;
          issues.push({ moduleId: a.id, fieldId: aField.id,
            message: `与存档模块“${b.name || "未命名模块"}”中的字段“${bField.name || "未命名字段"}”的全局位范围重叠。` });
          issues.push({ moduleId: b.id, fieldId: bField.id,
            message: `与存档模块“${a.name || "未命名模块"}”中的字段“${aField.name || "未命名字段"}”的全局位范围重叠。` });
        }
      }
    }
  }
  return issues;
}

function assertField(field: SaveModuleField) {
  const messages = fieldMessages(field);
  if (messages.length) throw new Error(messages[0]);
}

function assertInt32(value: number) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error("存档整数必须是 −2147483648 到 2147483647 内的整数。");
  }
}

function assertValues(values: number[]) {
  if (!Array.isArray(values) || values.length !== SAVE_INTEGER_COUNT) throw new Error(`存档整数列表必须包含 ${SAVE_INTEGER_COUNT} 个整数。`);
  for (const value of values) assertInt32(value);
}

/** Show a signed game Int32 as all 32 source bits, highest bit first. */
export function formatSaveIntegerBinary(value: number): string {
  assertInt32(value);
  return BigInt.asUintN(32, BigInt(value)).toString(2).padStart(32, "0");
}

/** Concatenate the complete 32 bits of every integer in list order. */
export function formatSaveBinary(values: number[]): string {
  assertValues(values);
  return values.map(formatSaveIntegerBinary).join("");
}

/** Show actual source bits, including leading zeros, independently of the declared numeric range. */
export function getSaveFieldBinary(values: number[], field: SaveModuleField): string {
  const length = getSaveFieldBitLength(field);
  return formatSaveBinary(values).slice(field.startBit, field.startBit + length);
}

/** Read an unsigned global span as exact decimal text, even for more than 53 source bits. */
export function readSaveFieldValue(values: number[], field: SaveModuleField): string {
  return BigInt(`0b${getSaveFieldBinary(values, field)}`).toString();
}

/** Replace only this global span and return 100 signed game Int32 values without mutating the input. */
export function writeSaveFieldValue(values: number[], field: SaveModuleField, newValue: string | number | bigint): number[] {
  assertValues(values);
  assertField(field);
  let replacement: bigint | undefined;
  if (typeof newValue === "bigint") replacement = newValue;
  else if (typeof newValue === "number") {
    if (Number.isSafeInteger(newValue)) replacement = BigInt(newValue);
  } else replacement = decimalValue(newValue);
  if (replacement === undefined || replacement < BigInt(field.min) || replacement > BigInt(field.max)) {
    throw new Error(`字段值必须是 ${field.min}–${field.max} 内的整数；超过安全整数范围时请使用十进制字符串。`);
  }
  const source = formatSaveBinary(values);
  const binary = replacement.toString(2).padStart(field.length, "0");
  const next = source.slice(0, field.startBit) + binary + source.slice(field.startBit + field.length);
  const result = values.slice();
  const firstInteger = Math.floor(field.startBit / 32);
  const lastInteger = Math.floor((field.startBit + field.length - 1) / 32);
  for (let index = firstInteger; index <= lastInteger; index++) {
    result[index] = Number(BigInt.asIntN(32, BigInt(`0b${next.slice(index * 32, (index + 1) * 32)}`)));
  }
  return result;
}
