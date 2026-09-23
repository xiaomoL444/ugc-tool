declare module "genshin-impact-ugc-file-converter-web" {
  export type UgcFileType = "gil" | "gia";
  export type UgcValue = null | boolean | number | string | UgcValue[] | { [key: string]: UgcValue };

  export interface ConverterDocument {
    filetype: UgcFileType;
    dirtype: "Unknown";
    info: Record<"1" | "2" | "3" | "4", number>;
    json: UgcValue;
    dtype_csv: string;
  }

  export function decode(input: ArrayBuffer | ArrayBufferView, options: { type: UgcFileType }): ConverterDocument;
  export function encode(document: ConverterDocument, options?: { type?: UgcFileType }): Uint8Array;
  export function parse(text: string): ConverterDocument;
  export function stringify(document: ConverterDocument, space?: number | string): string;
}
