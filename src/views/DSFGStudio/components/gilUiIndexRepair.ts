const CONFIRM_UI = "[通用]确认提示_Default_UI";
const DIALOGUE_UI = "[对话]Dialog_Default_UI";
const TARGETS = [
  { name: "Black_Screen_Script", path: "Action_Dialog/TalkDialog/TalkStyles/Black_Screen_Script.lua", variables: [CONFIRM_UI] },
  { name: "Dialog_Bottom_CG", path: "Action_Dialog/TalkDialog/TalkStyles/Bottom_CG_Script.lua", variables: [CONFIRM_UI] },
  { name: "Bottom_Dialog_Script.lua", path: "Action_Dialog/TalkDialog/TalkStyles/Bottom_Dialog_Script.lua", variables: [CONFIRM_UI] },
  { name: "Dialogue_Default_UI_Script", path: "Action_Dialog/TalkDialog/TalkStyles/Default_UI_Script.lua", variables: [CONFIRM_UI, DIALOGUE_UI] },
  { name: "Default", path: "Message_Dialog/styles/Default.lua", variables: [DIALOGUE_UI] },
];

export interface GilUiIndexRepairRow {
  script: string;
  path: string;
  variable: string;
  previous: number[];
  index: number;
  changed: boolean;
}
export interface GilUiIndexRepairResult {
  bytes: Uint8Array;
  ui: { name: string; index: number }[];
  rows: GilUiIndexRepairRow[];
  warnings: string[];
}

interface Field {
  id: number;
  wire: number;
  start: number;
  tagEnd: number;
  dataStart: number;
  end: number;
  integer?: bigint;
  children?: Field[];
  replacement?: number;
}
const invalid = (): never => { throw new Error("无法读取 GIL：文件已损坏或格式不受支持。"); };
const decoder = new TextDecoder("utf-8", { fatal: true });
const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^default_import_file\//, "");
const validIndex = (value: bigint | undefined): value is bigint => value !== undefined && value > 0n && value <= 2147483647n;

function varint(bytes: Uint8Array, cursor: { offset: number }, end: number): bigint {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    if (cursor.offset >= end) return invalid();
    const byte = bytes[cursor.offset++];
    if (i === 9 && byte > 1) return invalid();
    value |= BigInt(byte & 127) << BigInt(i * 7);
    if (!(byte & 128)) return value;
  }
  return invalid();
}
function encodeVarint(input: number): Uint8Array {
  let value = BigInt(input);
  const bytes: number[] = [];
  do { bytes.push(Number(value & 127n) | (value > 127n ? 128 : 0)); value >>= 7n; } while (value);
  return Uint8Array.from(bytes);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Read only known messages. Unknown payloads, Lua source and field order stay opaque. */
export function repairGilUiIndices(input: ArrayBuffer | ArrayBufferView): GilUiIndexRepairResult {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 24) return invalid();
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodySize = header.getUint32(16, false), bodyEnd = 20 + bodySize;
  if (header.getUint32(0, false) !== bodyEnd || bodyEnd + 4 > bytes.length) return invalid();

  function fields(start: number, end: number): Field[] {
    const result: Field[] = [], cursor = { offset: start };
    while (cursor.offset < end) {
      const start = cursor.offset, tag = varint(bytes, cursor, end), wire = Number(tag & 7n), id = Number(tag >> 3n);
      if (id <= 0 || id > 0x1fffffff) return invalid();
      const tagEnd = cursor.offset;
      let dataStart = cursor.offset, integer: bigint | undefined;
      if (wire === 0) integer = varint(bytes, cursor, end);
      else if (wire === 2) {
        const length = varint(bytes, cursor, end);
        if (length > BigInt(end - cursor.offset)) return invalid();
        dataStart = cursor.offset; cursor.offset += Number(length);
      } else if (wire === 1) cursor.offset += 8;
      else if (wire === 5) cursor.offset += 4;
      else return invalid();
      if (cursor.offset > end) return invalid();
      result.push({ id, wire, start, tagEnd, dataStart, end: cursor.offset, integer });
    }
    return result;
  }
  const children = (field: Field) => field.children ?? (field.children = fields(field.dataStart, field.end));
  const messages = (entries: Field[], id: number) => entries.filter(field => field.id === id && field.wire === 2).map(children);
  // Repeated scalar keys are rejected instead of choosing one arbitrarily.
  const scalar = (entries: Field[], id: number, wire: number) => {
    const matches = entries.filter(field => field.id === id);
    return matches.length === 1 && matches[0].wire === wire ? matches[0] : undefined;
  };
  const integer = (entries: Field[], id: number) => scalar(entries, id, 0)?.integer;
  const text = (entries: Field[], id: number) => {
    const field = scalar(entries, id, 2);
    if (!field) return "";
    try { return decoder.decode(bytes.subarray(field.dataStart, field.end)); } catch { return ""; }
  };
  const root = fields(20, bodyEnd);
  // 9/502 contains client control templates. Container controls and graph references are excluded.
  const controls = messages(root, 9).flatMap(section => messages(section, 502));
  const ui = [CONFIRM_UI, DIALOGUE_UI].map(name => {
    const matches = controls.filter(control => messages(control, 505).some(component =>
      messages(component, 12).some(label => text(label, 501) === name)));
    if (!matches.length) throw new Error(`GIL 中未找到客户端控件「${name}」，无法修复索引。`);
    if (matches.some(control => !validIndex(integer(control, 501)))) throw new Error(`客户端控件「${name}」的索引无效。`);
    const indices = [...new Set(matches.map(control => Number(integer(control, 501))))];
    if (indices.length !== 1) throw new Error(`客户端控件「${name}」存在多个同名索引（${indices.join("、")}），请先在千星编辑器中确认。`);
    return { name, index: indices[0] };
  });
  const scripts = messages(root, 50).flatMap(section => messages(section, 1));
  const rows: GilUiIndexRepairRow[] = [], warnings: string[] = [];
  for (const target of TARGETS) {
    const matches = scripts.filter(script => {
      const path = normalizePath(text(script, 3));
      // Default must match its full path. Other named scripts may omit the path in older archives.
      return path === target.path || (target.name !== "Default" && !path && text(script, 2) === target.name);
    });
    if (matches.length !== 1) {
      warnings.push(`「${target.name}」${matches.length ? "存在多个脚本，已跳过" : "未找到"}（/${target.path}）。`);
      continue;
    }
    const script = matches[0];
    for (const variable of target.variables) {
      const values: Field[] = [];
      let malformed = false;
      // 7 and 8 are the two stored parameter snapshots; repair every existing copy together.
      for (const snapshot of [7, 8]) {
        const parameters = messages(script, snapshot).filter(parameter => text(parameter, 2) === variable);
        if (parameters.length > 1) malformed = true;
        for (const parameter of parameters) {
          const valueMessages = messages(parameter, 4);
          const references = valueMessages.length === 1 ? messages(valueMessages[0], 102) : [];
          const value = references.length === 1 ? scalar(references[0], 1, 0) : undefined;
          // A client-control reference is an integer parameter (3), never a script mapping or UI node.
          if (integer(parameter, 3) !== 3n || !value || value.integer! > 2147483647n) malformed = true;
          else values.push(value);
        }
      }
      if (malformed || !values.length) {
        warnings.push(`「${target.name}」的变量「${variable}」${malformed ? "格式不受支持，已跳过" : "未找到"}。`);
        continue;
      }
      const index = ui.find(control => control.name === variable)!.index;
      const previous = [...new Set(values.map(value => Number(value.integer)))];
      const changed = previous.some(value => value !== index);
      rows.push({ script: target.name, path: text(script, 3) || target.path, variable, previous, index, changed });
      for (const value of values) if (value.integer !== BigInt(index)) value.replacement = index;
    }
  }
  if (!rows.length) throw new Error(`未找到可修复的客户端脚本变量。${warnings.join("")}`);

  function serialize(entries: Field[]): { data: Uint8Array; changed: boolean } {
    let changed = false;
    const parts = entries.map(field => {
      if (field.replacement !== undefined) {
        changed = true;
        return concat([bytes.subarray(field.start, field.tagEnd), encodeVarint(field.replacement)]);
      }
      if (field.children) {
        const result = serialize(field.children);
        if (result.changed) {
          changed = true;
          return concat([bytes.subarray(field.start, field.tagEnd), encodeVarint(result.data.length), result.data]);
        }
      }
      return bytes.subarray(field.start, field.end);
    });
    return { data: changed ? concat(parts) : entries.length
      ? bytes.subarray(entries[0].start, entries[entries.length - 1].end) : new Uint8Array(), changed };
  }
  // Preserve all unrelated bytes, header metadata, trailer and any trailing extension data.
  const body = serialize(root);
  if (!body.changed) return { bytes: bytes.slice(), ui, rows, warnings };
  const output = concat([bytes.subarray(0, 20), body.data, bytes.subarray(bodyEnd)]);
  const view = new DataView(output.buffer);
  view.setUint32(0, body.data.length + 20, false);
  view.setUint32(16, body.data.length, false);
  return { bytes: output, ui, rows, warnings };
}
