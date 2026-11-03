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

test("selected paths match full decoding without including siblings or losing repeated fields", () => {
  const schema = '10,,object\n10/1,,string\n10/6,*,object\n10/6/1,,int32\n15,,object\n15/1,,object\n15/1/1,,int32\n15/2,,int32\n';
  const document: ConverterDocument = {
    filetype: 'gil', dirtype: 'Unknown', info: { '1': 1, '2': 2, '3': 3, '4': 4 }, dtype_csv: schema,
    json: { '10': { '1': 'string:unrelated graphs', '6': [{ '1': 11 }, { '1': 12 }] }, '15': { '1': { '1': 21 }, '2': 22 } },
  };
  const bytes = encodeUgc(document, schema);
  const expected = { '10': { '6': [{ '1': 11 }, { '1': 12 }] }, '15': { '1': { '1': 21 } } };
  assert.deepEqual(decodeUgc(bytes, 'gil', schema, ['10/6', '15/1']).json, expected);
  for (const paths of [['10', '10/6'], ['10/6', '10']]) {
    assert.deepEqual(decodeUgc(bytes, 'gil', schema, paths).json, { '10': document.json['10'] });
  }
  assert.deepEqual(decodeUgc(bytes, 'gil', schema, []).json, {});
  assert.deepEqual(decodeUgc(bytes, 'gil', schema, ['99/1']).json, {});
  for (const invalid of ['', '/10', '10/', '10//6', '10/a', '010/6']) {
    assert.throws(() => decodeUgc(bytes, 'gil', schema, [invalid]), /paths/);
  }
  assert.throws(() => decodeUgc(bytes, 'gil', schema, ['10/1/1']), /不是对象/);
});

function varint(input: number): number[] {
  const bytes = [];
  do { const value = input & 127; input = Math.floor(input / 128); bytes.push(value | (input ? 128 : 0)); } while (input);
  return bytes;
}

function archive(body: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(body.length + 24), view = new DataView(bytes.buffer);
  view.setUint32(0, body.length + 20, false); view.setUint32(16, body.length, false);
  bytes.set(body, 20); return bytes;
}

test("full and selected decoding retain all fields in maps exceeding two million fields", () => {
  const schema = '10,,object\n10/6,,object\n10/6/1,,int32\n27,,object\n27/1,*,int32\n';
  const fieldCount = 2_000_001;
  const payloadSize = fieldCount * 2;
  const prefix = Uint8Array.from([0x52, 4, 0x32, 2, 8, 42, 0xda, 1, ...varint(payloadSize)]);
  const body = new Uint8Array(prefix.length + payloadSize);
  body.set(prefix);
  for (let i = prefix.length; i < body.length; i += 2) body[i] = 8;
  body[body.length - 1] = 7;
  const bytes = archive(body);
  const full = decodeUgc(bytes, 'gil', schema).json as { '10': unknown; '27': { '1': number[] } };
  assert.deepEqual(full['10'], { '6': { '1': 42 } });
  assert.equal(full['27']['1'].length, fieldCount);
  assert.equal(full['27']['1'][0], 0);
  assert.equal(full['27']['1'].at(-1), 7);
  assert.deepEqual(decodeUgc(bytes, 'gil', schema, ['10/6']).json, { '10': { '6': { '1': 42 } } });
  const selected = decodeUgc(bytes, 'gil', schema, ['27']).json as { '27': { '1': number[] } };
  assert.deepEqual(Object.keys(selected), ['27']);
  assert.deepEqual(selected['27'], full['27']);
});

test("selection still rejects truncated and unsupported outer field encodings", () => {
  for (const body of [[0xda, 1, 10, 8], [0xda, 1, 128], [0xd9, 1]]) {
    assert.throws(() => decodeUgc(archive(Uint8Array.from(body)), 'gil', dtype, ['10/6']), /截断|编码类型/);
  }
});
