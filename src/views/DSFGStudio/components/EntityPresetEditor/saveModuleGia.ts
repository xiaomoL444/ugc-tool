import type { UgcValue } from "genshin-impact-ugc-file-converter-web";

export interface SaveModuleGiaCandidate {
  id: string;
  name: string;
  values: number[];
}

export interface SaveModuleGiaResult {
  candidates: SaveModuleGiaCandidate[];
}

export type SaveModuleGiaErrorCode = "invalidFile" | "notFound" | "invalidList" | "invalidLength" | "int32Overflow";

export class SaveModuleGiaError extends Error {
  constructor(public readonly code: SaveModuleGiaErrorCode, message: string) {
    super(message);
    this.name = "SaveModuleGiaError";
  }
}

const STATE_LIST_NAME = "游戏实体状态列表";
const LIST_LENGTH = 100;
const INT32_MIN = -2147483648n;
const INT32_MAX = 2147483647n;
const UINT32_MAX = 4294967295n;
const UINT64_MAX = 18446744073709551615n;
const SIGN_EXTENDED_INT32_MIN = UINT64_MAX + 1n + INT32_MIN;
type GiaObject = { [key: string]: UgcValue };

function fail(code: SaveModuleGiaErrorCode): never {
  const messages: Record<SaveModuleGiaErrorCode, string> = {
    invalidFile: "无法读取 GIA 文件，文件内容已截断、损坏或格式不受支持。",
    notFound: "GIA 中没有找到存档模块的游戏实体状态列表。",
    invalidList: "游戏实体状态列表必须为整数列表。",
    invalidLength: "游戏实体状态列表的长度必须为 100。",
    int32Overflow: "游戏实体状态列表包含超出 32 位整数范围的值。",
  };
  throw new SaveModuleGiaError(code, messages[code]);
}

function asObject(value: UgcValue | undefined): GiaObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function entries(value: UgcValue | undefined): UgcValue[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function base64Bytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return fail("invalidList");
  }
}

function textValue(value: UgcValue | undefined): string {
  if (typeof value !== "string") return "";
  if (value.startsWith("string:")) return value.slice(7);
  if (!value.startsWith("base64:")) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(base64Bytes(value.slice(7)));
  } catch {
    return "";
  }
}

/** Accept both protobuf's uint32 representation and sign-extended int32 varints. */
function signedInt32(value: bigint): number {
  if (value >= INT32_MIN && value <= INT32_MAX) return Number(value);
  if (value >= 0n && value <= UINT32_MAX) return Number(BigInt.asIntN(32, value));
  if (value >= SIGN_EXTENDED_INT32_MIN && value <= UINT64_MAX) return Number(BigInt.asIntN(64, value));
  return fail("int32Overflow");
}

function decodedInteger(value: UgcValue): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return signedInt32(BigInt(value));
  if (typeof value === "string" && /^int64:-?\d+$/.test(value)) return signedInt32(BigInt(value.slice(6)));
  return fail("invalidList");
}

interface Cursor { offset: number }

function varint(bytes: Uint8Array, cursor: Cursor): bigint {
  let value = 0n;
  for (let index = 0; index < 10; index++) {
    if (cursor.offset >= bytes.length) return fail("invalidList");
    const byte = bytes[cursor.offset++];
    if (index === 9 && byte > 1) return fail("int32Overflow");
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if (!(byte & 0x80)) return value;
  }
  return fail("invalidList");
}

/** Read the packed protobuf int32 payload, retaining each zero and its position. */
export function decodeSaveModulePackedInt32(bytes: Uint8Array): number[] {
  const cursor: Cursor = { offset: 0 };
  const values: number[] = [];
  while (cursor.offset < bytes.length) {
    values.push(signedInt32(varint(bytes, cursor)));
    if (values.length > LIST_LENGTH) return fail("invalidLength");
  }
  return values;
}

function listValues(field: GiaObject): number[] {
  const body = asObject(field["18"]);
  if (!body || body["1"] === undefined) return fail("invalidList");
  const raw = body["1"];
  const values = typeof raw === "string" && raw.startsWith("base64:")
    ? decodeSaveModulePackedInt32(base64Bytes(raw.slice(7)))
    : entries(raw).map(decodedInteger);
  if (values.length !== LIST_LENGTH) return fail("invalidLength");
  return values;
}

function checkedResult(candidates: SaveModuleGiaCandidate[]): SaveModuleGiaResult {
  if (candidates.length === 0) return fail("notFound");
  return { candidates };
}

function candidateName(saveName: string, structureId: UgcValue | undefined, instanceId: UgcValue | undefined, ordinal: number): string {
  const suffix = [structureId, instanceId].filter(value => typeof value === "number" || typeof value === "string").map(value => String(value).replace(/^int64:/, "")).join(" / ");
  return `${saveName || STATE_LIST_NAME} [${suffix || ordinal}]`;
}

/**
 * Read already-decoded GIA data. Only native save assets (41), struct instances
 * (25), and the named integer-list field (8) in the verified schema are eligible.
 * A codec-inferred object is intentionally rejected; importSaveModuleGia reads
 * its original packed bytes instead, because inference can lose list ordering.
 */
export function readSaveModuleGia(json: UgcValue): SaveModuleGiaResult {
  const root = asObject(json);
  if (!root) return fail("invalidFile");
  const candidates: SaveModuleGiaCandidate[] = [];
  for (const assetKey of ["1", "2"]) {
    entries(root[assetKey]).forEach((assetValue, assetIndex) => {
      const asset = asObject(assetValue);
      if (asset?.["5"] !== 41) return;
      entries(asObject(asset["25"])?.["1"]).forEach((saveValue, saveIndex) => {
        const save = asObject(asObject(asObject(saveValue)?.["100"])?.["1"]);
        if (!save) return;
        const saveName = textValue(save["501"]) || textValue(asset["3"]);
        entries(save["1"]).forEach((structureValue, structureIndex) => {
          const structure = asObject(structureValue);
          if (!structure) return;
          entries(structure["2"]).forEach((instanceValue, instanceIndex) => {
            const instance = asObject(instanceValue);
            if (instance?.["1"] !== 25) return;
            const body = asObject(instance["35"]);
            entries(body?.["1"]).forEach((fieldValue, fieldIndex) => {
              const field = asObject(fieldValue);
              if (!field || textValue(field["501"]) !== STATE_LIST_NAME) return;
              const descriptor = asObject(field["2"]);
              if (field["1"] !== 8 || (field["2"] !== undefined && (!descriptor || descriptor["1"] !== 8))) return fail("invalidList");
              candidates.push({
                id: `${assetKey}:${assetIndex}/${saveIndex}/${structureIndex}/${instanceIndex}/${fieldIndex}/${candidates.length}`,
                name: candidateName(saveName, structure["501"], asObject(body?.["502"])?.["4"], candidates.length + 1),
                values: listValues(field),
              });
            });
          });
        });
      });
    });
  }
  return checkedResult(candidates);
}

interface BinaryField { id: number; wire: number; value: bigint | Uint8Array }

/** Read one protobuf message without guessing the type of length-delimited data. */
function binaryFields(bytes: Uint8Array): BinaryField[] {
  const fields: BinaryField[] = [];
  const cursor: Cursor = { offset: 0 };
  while (cursor.offset < bytes.length) {
    const tag = varint(bytes, cursor);
    const id = Number(tag >> 3n), wire = Number(tag & 7n);
    if (id < 1 || id > 0x1fffffff) return fail("invalidFile");
    if (wire === 0) fields.push({ id, wire, value: varint(bytes, cursor) });
    else if (wire === 2) {
      const size = varint(bytes, cursor);
      if (size > BigInt(bytes.length - cursor.offset)) return fail("invalidFile");
      const end = cursor.offset + Number(size);
      fields.push({ id, wire, value: bytes.subarray(cursor.offset, end) });
      cursor.offset = end;
    } else if (wire === 1 || wire === 5) {
      const end = cursor.offset + (wire === 1 ? 8 : 4);
      if (end > bytes.length) return fail("invalidFile");
      fields.push({ id, wire, value: bytes.subarray(cursor.offset, end) });
      cursor.offset = end;
    } else return fail("invalidFile");
  }
  return fields;
}

function messages(fields: BinaryField[], id: number): BinaryField[][] {
  return fields.filter(field => field.id === id && field.wire === 2).map(field => binaryFields(field.value as Uint8Array));
}

function integerField(fields: BinaryField[] | undefined, id: number): number | undefined {
  const field = fields?.find(field => field.id === id && field.wire === 0);
  if (!field || typeof field.value !== "bigint" || field.value > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(field.value);
}

function stringField(fields: BinaryField[], id: number): string {
  const field = fields.find(field => field.id === id && field.wire === 2);
  if (!field) return "";
  try { return new TextDecoder("utf-8", { fatal: true }).decode(field.value as Uint8Array); }
  catch { return ""; }
}

function nativeListValues(fields: BinaryField[]): number[] {
  const listBodies = messages(fields, 18);
  if (listBodies.length !== 1) return fail("invalidList");
  const payloads = listBodies[0].filter(field => field.id === 1);
  if (!payloads.length) return fail("invalidLength");
  const values: number[] = [];
  for (const payload of payloads) {
    if (payload.wire === 2) values.push(...decodeSaveModulePackedInt32(payload.value as Uint8Array));
    else if (payload.wire === 0) values.push(signedInt32(payload.value as bigint));
    else return fail("invalidList");
    if (values.length > LIST_LENGTH) return fail("invalidLength");
  }
  if (values.length !== LIST_LENGTH) return fail("invalidLength");
  return values;
}

/** Decode a native GIA without relying on heuristic decoding of packed lists. */
export async function importSaveModuleGia(bytes: Uint8Array): Promise<SaveModuleGiaResult> {
  try {
    const { decode } = await import("genshin-impact-ugc-file-converter-web");
    decode(bytes, { type: "gia" });
  }
  catch { return fail("invalidFile"); }
  // The converter checks the GIA header; use its declared body size and respect
  // a Uint8Array view's offset when reading the original protobuf payload.
  const bodySize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, false);
  const root = binaryFields(bytes.subarray(20, 20 + bodySize));
  const candidates: SaveModuleGiaCandidate[] = [];
  for (const assetKey of [1, 2]) {
    messages(root, assetKey).forEach((asset, assetIndex) => {
      if (integerField(asset, 5) !== 41) return;
      const assetName = stringField(asset, 3);
      messages(asset, 25).flatMap(envelope => messages(envelope, 1)).forEach((saveHeader, saveIndex) => {
        messages(saveHeader, 100).flatMap(envelope => messages(envelope, 1)).forEach(save => {
          const saveName = stringField(save, 501) || assetName;
          messages(save, 1).forEach((structure, structureIndex) => {
            messages(structure, 2).forEach((instance, instanceIndex) => {
              if (integerField(instance, 1) !== 25) return;
              messages(instance, 35).forEach(body => {
                messages(body, 1).forEach((field, fieldIndex) => {
                  if (stringField(field, 501) !== STATE_LIST_NAME) return;
                  const descriptor = messages(field, 2)[0];
                  if (integerField(field, 1) !== 8 || (field.some(value => value.id === 2) && (!descriptor || integerField(descriptor, 1) !== 8))) return fail("invalidList");
                  candidates.push({
                    id: `${assetKey}:${assetIndex}/${saveIndex}/${structureIndex}/${instanceIndex}/${fieldIndex}/${candidates.length}`,
                    name: candidateName(saveName, integerField(structure, 501), integerField(messages(body, 502)[0], 4), candidates.length + 1),
                    values: nativeListValues(field),
                  });
                });
              });
            });
          });
        });
      });
    });
  }
  return checkedResult(candidates);
}
