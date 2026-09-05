export type UgcFileType = "gil" | "gia";

export type UgcValue = null | boolean | number | string | UgcValue[] | { [key: string]: UgcValue };
type Value = UgcValue;
type DataKind = "object" | "string" | "data" | "unknown";

interface DtypeNode {
  multiple: boolean;
  int32: boolean;
  int64: boolean;
  float32: boolean;
  float64: boolean;
  object: boolean;
  string: boolean;
  data: boolean;
  sample?: Uint8Array;
  dataSize?: number;
}

export interface ConverterDocument {
  filetype: UgcFileType;
  dirtype: "Unknown";
  info: Record<"1" | "2" | "3" | "4", number>;
  json: Value;
  dtype_csv: string;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const MAX_DEPTH = 128;
const MAX_FIELDS = 2_000_000;

class BinaryReader {
  offset = 0;
  error = false;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }
  get eof() { return this.offset >= this.bytes.length; }
  readByte() {
    if (this.offset >= this.bytes.length) { this.error = true; return 0; }
    return this.bytes[this.offset++];
  }
  readVarint() {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = this.readByte();
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
    }
    this.error = true;
    return 0n;
  }
  readFloat32() {
    if (this.offset + 4 > this.bytes.length) { this.error = true; return 0; }
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getFloat32(0, true);
    this.offset += 4;
    return value;
  }
  readData(length: bigint) {
    if (length < 0n || length > BigInt(this.bytes.length - this.offset)) {
      this.error = true;
      return new Uint8Array();
    }
    const size = Number(length);
    const result = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return result;
  }
}

class BinaryWriter {
  private values: number[] = [];
  writeByte(value: number) { this.values.push(value & 0xff); }
  writeBytes(bytes: Uint8Array) { for (const value of bytes) this.values.push(value); }
  writeVarint(input: bigint) {
    let value = BigInt.asUintN(64, input);
    do {
      let byte = Number(value & 0x7fn);
      value >>= 7n;
      if (value) byte |= 0x80;
      this.writeByte(byte);
    } while (value);
  }
  writeFloat32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    this.writeBytes(bytes);
  }
  writeData(bytes: Uint8Array) { this.writeVarint(BigInt(bytes.length)); this.writeBytes(bytes); }
  finish() { return Uint8Array.from(this.values); }
}

function blankNode(): DtypeNode {
  return { multiple: false, int32: false, int64: false, float32: false, float64: false, object: false, string: false, data: false };
}

function parseDtype(csv: string) {
  const nodes = new Map<string, DtypeNode>();
  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const [path, multiple, type] = line.split(",", 4);
    if (!path || !type) continue;
    const node = blankNode();
    node.multiple = multiple === "*";
    if (type === "int") node.int32 = node.int64 = true;
    else if (type === "int32") node.int32 = true;
    else if (type === "int64") node.int64 = true;
    else if (type === "float") node.float32 = node.float64 = true;
    else if (type === "float32") node.float32 = true;
    else if (type === "float64") node.float64 = true;
    else if (type === "object") node.object = true;
    else if (type === "string") node.string = true;
    else if (type === "data") node.data = true;
    else if (type === "unknown") node.object = node.string = node.data = true;
    nodes.set(path, node);
  }
  return nodes;
}

function isIntUnknown(n: DtypeNode) { return n.int32 && n.int64; }
function isFloatUnknown(n: DtypeNode) { return n.float32 && n.float64; }
function isDataUnknown(n: DtypeNode) { return n.object && n.string && n.data; }

function isValidString(bytes: Uint8Array) {
  for (const b of bytes) if (b < 0x20 && b !== 9 && b !== 10 && b !== 13) return false;
  try { decoder.decode(bytes); return true; } catch { return false; }
}

function structurallyValid(bytes: Uint8Array) {
  const reader = new BinaryReader(bytes);
  while (!reader.eof && !reader.error) {
    const tag = reader.readVarint();
    switch (Number(tag & 7n)) {
      case 0: reader.readVarint(); break;
      case 2: reader.readData(reader.readVarint()); break;
      case 5: reader.readFloat32(); break;
      default: return false;
    }
  }
  return !reader.error;
}

function analyze(bytes: Uint8Array, nodes: Map<string, DtypeNode>, parent = "", depth = 0, count = { value: 0 }): void {
  if (depth > MAX_DEPTH) throw new Error("文件嵌套层级过深");
  const reader = new BinaryReader(bytes);
  const seen = new Map<string, number>();
  while (!reader.eof) {
    if (++count.value > MAX_FIELDS) throw new Error("文件字段数量过多");
    const tag = reader.readVarint();
    const type = Number(tag & 7n);
    const id = (tag >> 3n).toString();
    const path = parent ? `${parent}/${id}` : id;
    let node = nodes.get(path);
    if (!node) {
      node = { multiple: false, int32: true, int64: true, float32: true, float64: true, object: true, string: true, data: true };
      nodes.set(path, node);
    }
    seen.set(path, (seen.get(path) ?? 0) + 1);
    if (type === 0) {
      const value = reader.readVarint();
      node.float32 = node.float64 = node.object = node.string = node.data = false;
      if (value > 0xffffffffn) node.int32 = false;
      else if (value === 0xffffffffn) node.int64 = false;
    } else if (type === 2) {
      const value = reader.readData(reader.readVarint());
      node.int32 = node.int64 = node.float32 = node.float64 = false;
      if (node.object && structurallyValid(value)) {
        if (value.length) node.string = node.data = false;
        analyze(value, nodes, path, depth + 1, count);
      } else {
        node.object = false;
        node.dataSize = value.length;
        node.sample = value.slice(0, 16);
        if (node.string && !isValidString(value)) node.string = false;
      }
    } else if (type === 5) {
      reader.readFloat32();
      node.int32 = node.int64 = node.float64 = node.object = node.string = node.data = false;
    } else throw new Error(`不支持的字段编码类型 ${type}`);
    if (reader.error) throw new Error("文件内容已截断或损坏");
  }
  for (const [path, amount] of seen) if (amount >= 2) nodes.get(path)!.multiple = true;
}

function bigintValue(value: bigint, signedBits?: 32 | 64): Value {
  const signed = signedBits ? BigInt.asIntN(signedBits, value) : value;
  if (signed >= BigInt(Number.MIN_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(signed);
  return `int64:${signed}`;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value.replace(/^base64:/, ""));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeObject(bytes: Uint8Array, nodes: Map<string, DtypeNode>, parent = "", depth = 0): { [key: string]: Value } {
  if (depth > MAX_DEPTH) throw new Error("文件嵌套层级过深");
  const result: { [key: string]: Value } = {};
  const reader = new BinaryReader(bytes);
  while (!reader.eof) {
    const tag = reader.readVarint();
    const type = Number(tag & 7n);
    const id = (tag >> 3n).toString();
    const path = parent ? `${parent}/${id}` : id;
    const dtype = nodes.get(path);
    if (!dtype) throw new Error(`dtype 缺少字段 ${path}`);
    let value: Value;
    if (type === 0) {
      const raw = reader.readVarint();
      value = dtype.int32 && !dtype.int64 ? bigintValue(raw, 32) : bigintValue(raw, 64);
    } else if (type === 5 && dtype.float32) value = reader.readFloat32();
    else if (type === 2) {
      const data = reader.readData(reader.readVarint());
      if (dtype.object && !dtype.string && !dtype.data) value = decodeObject(data, nodes, path, depth + 1);
      else if (dtype.string && !dtype.object && !dtype.data) value = `string:${decoder.decode(data)}`;
      else value = `base64:${toBase64(data)}`;
    } else throw new Error(`字段 ${path} 的编码与 dtype 不匹配`);
    if (reader.error) throw new Error("文件内容已截断或损坏");
    if (dtype.multiple) {
      const current = result[id];
      if (!Array.isArray(current)) result[id] = [];
      (result[id] as Value[]).push(value);
    } else result[id] = value;
  }
  return result;
}

function dtypeType(node: DtypeNode): string {
  if (isIntUnknown(node)) return "int";
  if (node.int32) return "int32";
  if (node.int64) return "int64";
  if (isFloatUnknown(node)) return "float";
  if (node.float32) return "float32";
  if (node.float64) return "float64";
  if (isDataUnknown(node)) return "unknown,EmptyData";
  if (node.object) return "object";
  if (node.string) return "string";
  if (node.data) return "data";
  return "unknown";
}

function serializeDtype(nodes: Map<string, DtypeNode>) {
  const paths = [...nodes.keys()].sort((a, b) => {
    const aa = a.split("/").map(BigInt), bb = b.split("/").map(BigInt);
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1;
    return aa.length - bb.length;
  });
  return "# Path, Multiple keys, Type, Details\r\n" + paths.map(path => {
    const n = nodes.get(path)!;
    let details = "";
    if (n.data && n.dataSize) details = `,size=0x${n.dataSize.toString(16).toUpperCase()}: ${[...(n.sample ?? [])].map(v => v.toString(16).padStart(2, "0").toUpperCase()).join(" ")}`;
    return `${path},${n.multiple ? "*" : ""},${dtypeType(n)}${details}\r\n`;
  }).join("");
}

function readHeader(input: Uint8Array) {
  if (input.length < 24) throw new Error("GIL/GIA 文件小于最小头部长度");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const total = view.getUint32(0, false);
  const bodySize = view.getUint32(16, false);
  if (total !== bodySize + 20 || 20 + bodySize + 4 > input.length) throw new Error("GIL/GIA 文件头中的长度无效");
  return {
    info: { "1": view.getUint32(4, false), "2": view.getUint32(8, false), "3": view.getUint32(12, false), "4": view.getUint32(20 + bodySize, false) },
    body: input.subarray(20, 20 + bodySize),
  };
}

export function decodeUgc(input: Uint8Array, filetype: UgcFileType, baseDtypeCsv: string): ConverterDocument {
  const { info, body } = readHeader(input);
  const nodes = parseDtype(baseDtypeCsv);
  analyze(body, nodes);
  return { filetype, dirtype: "Unknown", info, json: decodeObject(body, nodes), dtype_csv: serializeDtype(nodes) };
}

function asBigInt(value: Value) {
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^int64:-?\d+$/.test(value)) return BigInt(value.slice(6));
  throw new Error(`整数值无效: ${String(value)}`);
}

function encodeObject(value: Value, nodes: Map<string, DtypeNode>, parent = "", depth = 0): Uint8Array {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("json 字段必须是对象");
  if (depth > MAX_DEPTH) throw new Error("JSON 嵌套层级过深");
  const writer = new BinaryWriter();
  const entries = Object.entries(value).sort(([a], [b]) => BigInt(a) < BigInt(b) ? -1 : 1);
  for (const [id, raw] of entries) {
    if (!/^\d+$/.test(id)) throw new Error(`字段 ID 不是非负整数: ${id}`);
    const path = parent ? `${parent}/${id}` : id;
    const dtype = nodes.get(path);
    if (!dtype) throw new Error(`dtype 缺少字段 ${path}`);
    const values = dtype.multiple ? raw : [raw];
    if (!Array.isArray(values)) throw new Error(`字段 ${path} 应为数组`);
    for (const item of values) {
      const tagBase = BigInt(id) << 3n;
      if (dtype.int32 || dtype.int64) {
        writer.writeVarint(tagBase);
        const integer = asBigInt(item);
        writer.writeVarint(dtype.int32 && !dtype.int64 ? BigInt.asUintN(32, integer) : BigInt.asUintN(64, integer));
      } else if (dtype.float32) {
        if (typeof item !== "number") throw new Error(`字段 ${path} 应为数字`);
        writer.writeVarint(tagBase | 5n);
        writer.writeFloat32(item);
      } else {
        let bytes: Uint8Array;
        if (dtype.object && !dtype.string && !dtype.data) bytes = encodeObject(item, nodes, path, depth + 1);
        else if (dtype.string && !dtype.object && !dtype.data) {
          if (typeof item !== "string") throw new Error(`字段 ${path} 应为字符串`);
          bytes = encoder.encode(item.replace(/^string:/, ""));
        } else {
          if (typeof item !== "string") throw new Error(`字段 ${path} 应为 base64 字符串`);
          bytes = fromBase64(item);
        }
        writer.writeVarint(tagBase | 2n);
        writer.writeData(bytes);
      }
    }
  }
  return writer.finish();
}

export function encodeUgc(document: ConverterDocument, fallbackDtypeCsv: string): Uint8Array {
  if (document.filetype !== "gil" && document.filetype !== "gia") throw new Error("filetype 只能是 gil 或 gia");
  const nodes = parseDtype(document.dtype_csv || fallbackDtypeCsv);
  const body = encodeObject(document.json, nodes);
  const output = new Uint8Array(24 + body.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, body.length + 20, false);
  view.setUint32(4, document.info?.["1"] ?? 0, false);
  view.setUint32(8, document.info?.["2"] ?? 0, false);
  view.setUint32(12, document.info?.["3"] ?? 0, false);
  view.setUint32(16, body.length, false);
  output.set(body, 20);
  view.setUint32(20 + body.length, document.info?.["4"] ?? 0, false);
  return output;
}
