import gilDtype from "../dtype/gil.csv";
import giaDtype from "../dtype/gia.csv";
import {
  decodeUgc,
  encodeUgc,
  type ConverterDocument,
  type UgcFileType,
  type UgcValue,
} from "../worker/converter";

export type { ConverterDocument, UgcFileType, UgcValue };

export interface DecodeOptions {
  /** GIL 与 GIA 使用相同的容器结构，文件字节本身无法可靠区分两者。 */
  type: UgcFileType;
}

export interface EncodeOptions {
  /** 可覆盖 document.filetype。 */
  type?: UgcFileType;
}

function bytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function dtype(type: UgcFileType): string {
  return type === "gil" ? gilDtype : giaDtype;
}

/** 将 GIL/GIA 二进制内容解码为可序列化的转换器文档。 */
export function decode(input: ArrayBuffer | ArrayBufferView, options: DecodeOptions): ConverterDocument {
  if (options.type !== "gil" && options.type !== "gia") throw new TypeError("type 只能是 gil 或 gia");
  return decodeUgc(bytes(input), options.type, dtype(options.type));
}

/** 将转换器文档编码为 GIL/GIA 二进制内容。 */
export function encode(document: ConverterDocument, options: EncodeOptions = {}): Uint8Array {
  const type = options.type ?? document.filetype;
  if (type !== "gil" && type !== "gia") throw new TypeError("filetype 只能是 gil 或 gia");
  const normalized = options.type ? { ...document, filetype: type } : document;
  return encodeUgc(normalized, dtype(type));
}

/** 解析并进行最低限度的文档结构检查。 */
export function parse(text: string): ConverterDocument {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new TypeError("JSON 根节点必须是对象");
  const document = value as Partial<ConverterDocument>;
  if (document.filetype !== "gil" && document.filetype !== "gia") throw new TypeError("JSON 中缺少有效的 filetype");
  if (!("json" in document)) throw new TypeError("JSON 中缺少 json 字段");
  return document as ConverterDocument;
}

/** 输出可读 JSON；超出安全范围的整数已经由 decode 表示为 int64:... 字符串。 */
export function stringify(document: ConverterDocument, space: number | string = 2): string {
  return JSON.stringify(document, null, space);
}
