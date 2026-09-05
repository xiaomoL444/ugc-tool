import { type ConverterDocument, type UgcFileType, type UgcValue } from "../worker/converter";
export type { ConverterDocument, UgcFileType, UgcValue };
export interface DecodeOptions {
    /** GIL 与 GIA 使用相同的容器结构，文件字节本身无法可靠区分两者。 */
    type: UgcFileType;
}
export interface EncodeOptions {
    /** 可覆盖 document.filetype。 */
    type?: UgcFileType;
}
/** 将 GIL/GIA 二进制内容解码为可序列化的转换器文档。 */
export declare function decode(input: ArrayBuffer | ArrayBufferView, options: DecodeOptions): ConverterDocument;
/** 将转换器文档编码为 GIL/GIA 二进制内容。 */
export declare function encode(document: ConverterDocument, options?: EncodeOptions): Uint8Array;
/** 解析并进行最低限度的文档结构检查。 */
export declare function parse(text: string): ConverterDocument;
/** 输出可读 JSON；超出安全范围的整数已经由 decode 表示为 int64:... 字符串。 */
export declare function stringify(document: ConverterDocument, space?: number | string): string;
