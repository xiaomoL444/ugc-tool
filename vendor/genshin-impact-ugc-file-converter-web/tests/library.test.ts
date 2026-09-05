import test from "node:test";
import assert from "node:assert/strict";
import { decode, encode, parse, stringify, type ConverterDocument } from "genshin-impact-ugc-file-converter-web";

test("public library API round-trips a minimal GIA document", () => {
  const document: ConverterDocument = {
    filetype: "gia",
    dirtype: "Unknown",
    info: { "1": 0, "2": 0, "3": 0, "4": 0 },
    json: {},
    dtype_csv: "# Path, Multiple keys, Type, Details\r\n",
  };
  const binary = encode(document);
  const decoded = decode(binary, { type: "gia" });
  assert.deepEqual(decoded.json, {});
  assert.deepEqual(parse(stringify(decoded)), decoded);
});
