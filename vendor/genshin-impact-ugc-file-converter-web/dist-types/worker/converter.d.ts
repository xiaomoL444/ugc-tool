export type UgcFileType = "gil" | "gia";
export type UgcValue = null | boolean | number | string | UgcValue[] | {
    [key: string]: UgcValue;
};
type Value = UgcValue;
export interface ConverterDocument {
    filetype: UgcFileType;
    dirtype: "Unknown";
    info: Record<"1" | "2" | "3" | "4", number>;
    json: Value;
    dtype_csv: string;
}
export declare function decodeUgc(input: Uint8Array, filetype: UgcFileType, baseDtypeCsv: string): ConverterDocument;
export declare function encodeUgc(document: ConverterDocument, fallbackDtypeCsv: string): Uint8Array;
export {};
