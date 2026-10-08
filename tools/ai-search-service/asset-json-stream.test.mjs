// Independent grammar/property tests. Uses only local bytes and synthetic streams.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BoundedJsonParser } from './asset-json-stream.mjs';
import { createAssetCatalogLoader } from './asset-catalog-loader.mjs';
import { identityFixture, featureFixture } from './asset-catalog-fixture.mjs';
const encoder = new TextEncoder();
function parseText(text, widths = [1], options) {
  const parser = new BoundedJsonParser(options);
  let index = 0, part = 0;
  while (index < text.length) { const width = widths[part++ % widths.length]; parser.feed(text.slice(index, index + width)); index += width; }
  return parser.finish();
}
function parseBytes(bytes, widths = [1], options) {
  const parser = new BoundedJsonParser(options), decoder = new TextDecoder('utf-8', { fatal: true });
  let index = 0, part = 0;
  while (index < bytes.length) { const width = widths[part++ % widths.length]; parser.feed(decoder.decode(bytes.subarray(index, index + width), { stream: true })); index += width; }
  parser.feed(decoder.decode());
  return parser.finish();
}
// Null-prototype objects are an intentional security difference. Compare every value,
// property order and type without serializing another full copy or logging source text.
function nativeEqual(actual, expected, path = '$') {
  if (expected === null || typeof expected !== 'object') { assert.ok(Object.is(actual, expected), `Primitive differs at ${path.slice(0, 250)}`); return; }
  assert.equal(Array.isArray(actual), Array.isArray(expected), `Container differs at ${path.slice(0, 250)}`);
  assert.equal(typeof actual, 'object'); assert.notEqual(actual, null);
  if (!Array.isArray(actual)) assert.equal(Object.getPrototypeOf(actual), null, `Unsafe object prototype at ${path.slice(0, 250)}`);
  const keys = Object.keys(expected), actualKeys = Object.keys(actual);
  assert.equal(actualKeys.length, keys.length, `Key count differs at ${path.slice(0, 250)}`);
  for (let index = 0; index < keys.length; index++) {
    assert.ok(actualKeys[index] === keys[index], `Key order differs at ${path.slice(0, 250)}`);
    nativeEqual(actual[keys[index]], expected[keys[index]], `${path}.${keys[index]}`);
  }
}
function nativeResult(text) { try { return { valid: true, value: JSON.parse(text) }; } catch { return { valid: false }; } }
function random(seed = 0x59a117) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
function streamedResponse(bytes, widths = [1]) {
  let index = 0, part = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (index >= bytes.length) { controller.close(); return; }
    const width = widths[part++ % widths.length]; controller.enqueue(bytes.subarray(index, index + width)); index += width;
  } }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
test('JSON grammar and Unicode remain identical at every two-piece boundary and one-character feeds', () => {
  const valid = [
    'null', 'true', 'false', '0', '-0', '1e400', '-1e400', '1e-400', '-0.0e+0', '9007199254740993',
    '[]', '{}', '[null,false,true,-3.25e-4]', '{"a":null,"b":false,"c":0}',
    '{"10":1,"2":2,"1":3,"01":4}', ' \t\r\n{"x": [ {"y":null}, [], {} ] }\r\n ',
    '"\\\"\\\\\\/\\b\\f\\n\\r\\t"', '"\\u0000\\u001f\\uD83D\\uDE00\\ud800\\udc00"',
    JSON.stringify({ text: '汉字😀𝄞日本語 русский\nquote"\\end\u0000', nested: [{ key: 'x\u2028y\u2029z\ufeff' }], empty: '' }),
  ];
  for (const text of valid) {
    const expected = JSON.parse(text);
    nativeEqual(parseText(text), expected);
    for (let index = 0; index <= text.length; index++) {
      const parser = new BoundedJsonParser(); parser.feed(text.slice(0, index)); parser.feed(text.slice(index)); nativeEqual(parser.finish(), expected);
      const finalParser = new BoundedJsonParser(); finalParser.feed(text.slice(0, index)); finalParser.feed(text.slice(index), true); nativeEqual(finalParser.finish(), expected);
    }
    for (const widths of [[2], [3], [17], [1, 7, 2, 31]]) nativeEqual(parseBytes(encoder.encode(text), widths), expected);
  }
});
test('invalid JSON never slips through whitespace, delimiter, colon, comma, escape or primitive handling', () => {
  const invalid = [
    '', ' ', '\n\t', 'undefined', 'NaN', 'Infinity', '-Infinity', 'True', 'FALSE', 'Null', 'true false', 'null0',
    '{', '[', ']', '}', '{"x"}', '{"x" 1}', '{"x"::1}', '{"x":}', '{x:1}', "{'x':1}", '{"x":1,}',
    '[,1]', '[1,,2]', '[1,]', '[1 2]', '[1:2]', '{,"x":1}', '{"x":1 "y":2}', '[{}{}]', '[[] []]',
    '01', '-01', '+1', '.1', '1.', '1e', '1E+', '1e-', '--1', '0x10', '1_000', '1e1e1', '1e++1', '1a',
    '"unterminated', '"\\"', '"\\x00"', '"\\v"', '"\\u123"', '"\\u0x00"', '"\\uFFFFF" trailing',
    '"a\nb"', '"a\rb"', '"a\tb"', '"a\u0000b"',
  ];
  for (const whitespace of ['\u000b', '\u000c', '\u00a0', '\u1680', '\u2000', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']) {
    invalid.push(`${whitespace}{}`, `true${whitespace}`, `[${whitespace}]`, `{"x"${whitespace}:1}`, `[1${whitespace},2]`);
  }
  for (const text of invalid) {
    assert.equal(nativeResult(text).valid, false, `Invalid fixture was native-valid: ${JSON.stringify(text).slice(0, 120)}`);
    for (const widths of [[1], [2], [7], [1, 13, 2]]) assert.throws(() => parseText(text, widths), SyntaxError, JSON.stringify(text).slice(0, 120));
  }
});
test('duplicate decoded keys are deliberately rejected, while prototype-named keys cannot pollute objects', () => {
  for (const text of ['{"x":1,"x":2}', '{"x":null,"x":null}', '{"a":1,"\\u0061":2}', '{"__proto__":1,"__proto__":2}', '{"x":{"a":0,"a":1}}']) {
    assert.equal(nativeResult(text).valid, true, 'Duplicate rejection is a deliberate stricter policy');
    for (const widths of [[1], [3], [31]]) assert.throws(() => parseText(text, widths), SyntaxError);
  }
  const text = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"toString":null,"hasOwnProperty":false,"prototype":[{"__proto__":"safe"}]}';
  nativeEqual(parseText(text), JSON.parse(text));
  const parsed = parseText(text, [7]);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(parsed.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});
test('node, nesting, string and scalar limits reject early and consumed input buffers are released', () => {
  nativeEqual(parseText('[0]', [1], { maxNodes: 2 }), [0]);
  nativeEqual(parseText('[[0]]', [1], { maxDepth: 2 }), [[0]]);
  assert.equal(parseText('"ab"', [1], { maxStringCharacters: 2 }), 'ab');
  assert.equal(parseText('""', [1], { maxStringCharacters: 0 }), '');
  for (const [options, text] of [[{ maxNodes: 2 }, '[0,1]'], [{ maxDepth: 2 }, '[[[0]]]'], [{ maxStringCharacters: 2 }, '"abc"'], [{ maxStringCharacters: 5 }, '"\\u0041"']]) assert.throws(() => parseText(text, [1], options), SyntaxError);
  const scalar = new BoundedJsonParser();
  assert.throws(() => { for (let index = 0; index < 129; index++) scalar.feed('9'); scalar.finish(); }, SyntaxError);
  assert.ok(scalar.buffer.length <= 129, 'An unfinished scalar cannot retain arbitrarily many chunks');
  const parser = new BoundedJsonParser(); parser.feed('[');
  for (let index = 0; index < 500; index++) { parser.feed('"chunk",'); assert.equal(parser.buffer.length, 0, 'Consumed token text is released each feed'); }
  parser.feed('null]'); assert.equal(parser.finish().length, 501); assert.equal(parser.buffer.length, 0);
});
test('deterministic property fuzz agrees with native parsing for valid trees and malformed text', () => {
  const rng = random();
  const strings = ['', 'quote"slash\\/\n\r\t', '\u0000\u001f', '汉字😀\u2028\ufeff', '\ud800', '\udc00', '__proto__', 'constructor'];
  const pick = list => list[Math.floor(rng() * list.length)];
  function tree(depth = 0) {
    const shape = Math.floor(rng() * (depth > 3 ? 4 : 6));
    if (shape === 0) return null;
    if (shape === 1) return rng() < .5;
    if (shape === 2) return pick([0, -0, Number.MIN_VALUE, Number.MAX_VALUE, Math.floor(rng() * 100000) / 37, -3.25e-4]);
    if (shape === 3) return pick(strings) + Math.floor(rng() * 10);
    if (shape === 4) return Array.from({ length: Math.floor(rng() * 6) }, () => tree(depth + 1));
    const value = Object.create(null);
    for (let index = 0, count = Math.floor(rng() * 6); index < count; index++) value[`${pick(strings)}_${index}`] = tree(depth + 1);
    return value;
  }
  for (let iteration = 0; iteration < 400; iteration++) {
    const text = ' \n' + JSON.stringify(tree(), null, pick([undefined, ' ', '\t'])) + '\r\n';
    const expected = JSON.parse(text);
    nativeEqual(parseText(text, [1, Math.floor(rng() * 31) + 1, 2]), expected);
    nativeEqual(parseBytes(encoder.encode(text), [1, 3, Math.floor(rng() * 43) + 1]), expected);
  }
  const alphabet = ['{', '}', '[', ']', ':', ',', '"', '\\', '0', '1', '-', '+', '.', 'e', 'n', 'u', 'l', 't', 'r', 'f', 'a', 's', ' ', '\n', '\t', '\u00a0', '\u000b'];
  let rejected = 0;
  for (let iteration = 0; iteration < 1000; iteration++) {
    const text = Array.from({ length: Math.floor(rng() * 40) }, () => pick(alphabet)).join('');
    const expected = nativeResult(text);
    if (expected.valid) nativeEqual(parseText(text, [1, 5, 2]), expected.value);
    else { assert.throws(() => parseText(text, [1, 5, 2]), SyntaxError, `Malformed fuzz case ${iteration}`); rejected++; }
  }
  assert.ok(rejected > 900);
});
test('fatal UTF-8 decoding catches overlong, surrogate, out-of-range and truncated sequences at boundaries', async () => {
  for (const bytes of [[0xc0, 0xaf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80], [0x80], [0xe2, 0x82], [0xf0, 0x9f, 0x98]]) {
    const payload = Uint8Array.from([0x22, ...bytes]);
    for (const widths of [[1], [2], [7]]) assert.throws(() => parseBytes(payload, widths), TypeError);
  }
  const identities = identityFixture();
  const valid = await featureFixture('sound', identities, '中文😀𝄞声音', '用途\n转义');
  const effect = await featureFixture('effect', identities, 'Русский 日本語😀');
  const loader = createAssetCatalogLoader({ identities, timeoutMs: 10000, fetcher: async url => streamedResponse(encoder.encode(JSON.stringify(url.includes('SoundEffectPlayer') ? valid : effect)), [1, 2, 7]) });
  const loaded = await loader.read({ ASSET_FEATURES_BASE_URL: 'https://offline.example/catalog' });
  assert.equal(loaded.featureSync.status, 'ready');
  assert.ok(loaded.catalog.assets.find(asset => asset.resourceId === 'sound:1').description['zh-CN'].includes('中文😀𝄞'));
  for (const payload of [Uint8Array.from([0x7b, 0x22, 0xc0, 0xaf]), Uint8Array.from([0x7b, 0x22, 0xe2, 0x82])]) {
    const invalidLoader = createAssetCatalogLoader({ identities, fetcher: async () => streamedResponse(payload, [1]) });
    await assert.rejects(() => invalidLoader.read({ ASSET_FEATURES_BASE_URL: 'https://offline.example/catalog' }), error => error.code === 'ASSET_FEATURES_INVALID');
  }
});
test('complete published feature bytes match native JSON.parse across varied UTF-8 stream chunks', async t => {
  for (const project of ['SoundEffectPlayer', 'EffectPlayer']) {
    const filename = new URL(`../../exports/ugc-tool-data/${project}/features.json`, import.meta.url);
    const bytes = await readFile(filename);
    const expected = JSON.parse(bytes.toString('utf8'));
    for (const widths of [[1021], [65536], [1048576], [1, 7, 31, 4096, 65536]]) {
      const before = performance.now();
      nativeEqual(parseBytes(bytes, widths), expected);
      t.diagnostic(JSON.stringify({ project, bytes: bytes.length, chunks: widths, milliseconds: Math.round(performance.now() - before) }));
    }
  }
});
