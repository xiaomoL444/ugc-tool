import test from "node:test";
import assert from "node:assert/strict";
import { decodeUgc, encodeUgc, type ConverterDocument } from "../worker/converter.ts";

const dtype = "# Path, Multiple keys, Type, Details\r\n1,,int32\r\n2,,string\r\n3,*,float32\r\n4,,int64\r\n";

test("GIL can be encoded, decoded, and encoded byte-for-byte", () => {
  const document: ConverterDocument = {
    filetype: "gil", dirtype: "Unknown", info: { "1": 1, "2": 2, "3": 3, "4": 4 }, dtype_csv: dtype,
    json: { "1": -42, "2": "string:测试", "3": [1.25, -2.5], "4": "int64:-9007199254740993" },
  };
  const binary = encodeUgc(document, dtype);
  const decoded = decodeUgc(binary, "gil", dtype);
  assert.deepEqual(decoded.json, document.json);
  assert.deepEqual(encodeUgc(decoded, dtype), binary);
});

test("invalid header is rejected", () => {
  assert.throws(() => decodeUgc(new Uint8Array(8), "gia", dtype), /头部/);
});
