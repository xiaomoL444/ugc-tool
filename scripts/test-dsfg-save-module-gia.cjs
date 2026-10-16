/* Run: node scripts/test-dsfg-save-module-gia.cjs [save-template.gia ...] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const STATE_LIST_NAME = '游戏实体状态列表';
const zeros = () => Array(100).fill(0);
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => 'base64:' + Buffer.from(value, 'utf8').toString('base64');
const packed = values => {
  const bytes = [];
  for (const input of values) {
    let value = BigInt(input);
    if (value < 0n) value = BigInt.asUintN(64, value);
    do {
      let byte = Number(value & 127n);
      value >>= 7n;
      if (value) byte |= 128;
      bytes.push(byte);
    } while (value);
  }
  return Uint8Array.from(bytes);
};
const packedValue = values => 'base64:' + Buffer.from(packed(values)).toString('base64');

function fixture(values = zeros(), listName = STATE_LIST_NAME) {
  const stateList = { '1': 8, '2': { '1': 8, '2': 'base64:' }, '18': { '1': packedValue(values) }, '501': text(listName) };
  const instance = { '1': 25, '2': { '1': 25, '2': { '1': 1, '2': 700 } }, '35': { '1': [stateList], '502': { '2': 28, '4': 800 } } };
  return { '1': { '1': { '2': 1, '3': 17, '4': 900 }, '5': 41, '25': { '1': { '1': 900, '2': 1, '100': { '1': { '1': [{ '1': 2, '2': [instance], '501': 700 }], '501': text('测试存档') } } } } } };
}

const stateField = json => json['1']['25']['1']['100']['1']['1'][0]['2'][0]['35']['1'][0];

// Fixtures supply their own known types to the encoder; the production decoder
// remains unchanged and can infer packed payloads as objects or raw base64.
function fixtureDocument(json) {
  const dtype = new Map();
  function visit(value, currentPath) {
    const multiple = Array.isArray(value);
    const sample = multiple ? value[0] : value;
    const kind = sample && typeof sample === 'object' ? 'object' : typeof sample === 'number' ? 'int' : String(sample).startsWith('base64:') ? 'data' : 'string';
    if (currentPath) dtype.set(currentPath, `${currentPath},${multiple ? '*' : ''},${kind}`);
    for (const item of multiple ? value : [value]) {
      if (item && typeof item === 'object') {
        for (const [key, child] of Object.entries(item)) visit(child, currentPath ? `${currentPath}/${key}` : key);
      }
    }
  }
  visit(json, '');
  return { filetype: 'gia', dirtype: 'Unknown', info: { '1': 1, '2': 806, '3': 3, '4': 1657 }, json, dtype_csv: [...dtype.values()].join('\n') };
}

async function main() {
  const converter = await import('genshin-impact-ugc-file-converter-web');
  const oldLoad = Module._load, oldTs = Module._extensions['.ts'];
  Module._load = function (request, parent, isMain) {
    return request === 'genshin-impact-ugc-file-converter-web' ? converter : oldLoad.call(this, request, parent, isMain);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, file);
  try {
    const importer = require(path.resolve(__dirname, '../src/views/DSFGStudio/components/EntityPresetEditor/saveModuleGia.ts'));
    const encode = json => converter.encode(fixtureDocument(json), { type: 'gia' });
    const rejectCode = code => error => error instanceof importer.SaveModuleGiaError && (Array.isArray(code) ? code.includes(error.code) : error.code === code);

    const allZeroBytes = encode(fixture());
    const allZero = await importer.importSaveModuleGia(allZeroBytes);
    assert.equal(allZero.candidates.length, 1);
    assert.deepEqual(allZero.candidates[0].values, zeros(), 'all-zero lists must retain 100 items');
    assert.match(allZero.candidates[0].name, /测试存档.*700.*800/);
    assert.deepEqual(importer.readSaveModuleGia(fixture()).candidates[0].values, zeros());

    const nativeNegative = zeros();
    nativeNegative[0] = -1; nativeNegative[1] = -2147483648; nativeNegative[2] = 2147483647; nativeNegative[99] = 7;
    assert.deepEqual((await importer.importSaveModuleGia(encode(fixture(nativeNegative)))).candidates[0].values, nativeNegative);
    const uint32Negative = zeros(); uint32Negative[0] = 4294967295; uint32Negative[1] = 2147483648;
    const signed = zeros(); signed[0] = -1; signed[1] = -2147483648;
    assert.deepEqual((await importer.importSaveModuleGia(encode(fixture(uint32Negative)))).candidates[0].values, signed);
    const splitPacked = fixture();
    stateField(splitPacked)['18']['1'] = [packedValue(nativeNegative.slice(0, 20)), packedValue(nativeNegative.slice(20))];
    assert.deepEqual((await importer.importSaveModuleGia(encode(splitPacked))).candidates[0].values, nativeNegative);
    const unpacked = fixture(); stateField(unpacked)['18']['1'] = nativeNegative;
    assert.deepEqual((await importer.importSaveModuleGia(encode(unpacked))).candidates[0].values, nativeNegative);

    const decodedNumbers = fixture();
    stateField(decodedNumbers)['18']['1'] = [-1, -2147483648, 2147483647, ...Array(97).fill(0)];
    assert.deepEqual(importer.readSaveModuleGia(decodedNumbers).candidates[0].values, stateField(decodedNumbers)['18']['1']);
    stateField(decodedNumbers)['18']['1'][0] = 'int64:18446744073709551615';
    assert.equal(importer.readSaveModuleGia(decodedNumbers).candidates[0].values[0], -1);
    const viewBacking = new Uint8Array(allZeroBytes.length + 37); viewBacking.set(allZeroBytes, 19);
    assert.deepEqual((await importer.importSaveModuleGia(viewBacking.subarray(19, 19 + allZeroBytes.length))).candidates[0].values, zeros());

    const multi = fixture();
    const save = multi['1']['25']['1']['100']['1'];
    const original = save['1'][0];
    const anotherInstance = clone(original['2'][0]);
    anotherInstance['35']['502']['4'] = 801;
    anotherInstance['35']['1'][0]['18']['1'] = packedValue(nativeNegative);
    original['2'].push(anotherInstance);
    const anotherStructure = clone(original); anotherStructure['501'] = 701;
    anotherStructure['2'] = [clone(anotherStructure['2'][0])];
    save['1'].push(anotherStructure);
    multi['2'] = clone(multi['1']); multi['2']['1']['4'] = 901;
    const multiResult = await importer.importSaveModuleGia(encode(multi));
    assert.equal(multiResult.candidates.length, 6, 'all matching structures, instances and member-pool assets are selectable');
    assert.equal(new Set(multiResult.candidates.map(candidate => candidate.id)).size, 6);
    assert.deepEqual(multiResult.candidates[1].values, nativeNegative);
    assert.equal(importer.readSaveModuleGia(multi).candidates.length, 6);

    for (const length of [0, 99, 101]) {
      await assert.rejects(importer.importSaveModuleGia(encode(fixture(Array(length).fill(0)))), rejectCode('invalidLength'));
      assert.throws(() => importer.readSaveModuleGia(fixture(Array(length).fill(0))), rejectCode('invalidLength'));
    }
    for (const overflow of [4294967296n, 9223372036854775807n, 18446744071562067967n]) {
      const values = zeros(); values[0] = overflow;
      await assert.rejects(importer.importSaveModuleGia(encode(fixture(values))), rejectCode('int32Overflow'));
    }
    for (const bad of [1.5, NaN, Infinity, 'string:1', 'int64:4294967296']) {
      const decoded = fixture(); stateField(decoded)['18']['1'] = zeros(); stateField(decoded)['18']['1'][0] = bad;
      assert.throws(() => importer.readSaveModuleGia(decoded), rejectCode(['invalidList', 'int32Overflow']));
    }
    const wrongType = fixture(); stateField(wrongType)['1'] = 3;
    await assert.rejects(importer.importSaveModuleGia(encode(wrongType)), rejectCode('invalidList'));
    const wrongDescriptor = fixture(); stateField(wrongDescriptor)['2']['1'] = 3;
    await assert.rejects(importer.importSaveModuleGia(encode(wrongDescriptor)), rejectCode('invalidList'));
    const malformedDescriptor = fixture(); stateField(malformedDescriptor)['2'] = 8;
    await assert.rejects(importer.importSaveModuleGia(encode(malformedDescriptor)), rejectCode('invalidList'));
    assert.throws(() => importer.readSaveModuleGia(malformedDescriptor), rejectCode('invalidList'));
    const partial = fixture();
    const invalidInstance = clone(partial['1']['25']['1']['100']['1']['1'][0]['2'][0]);
    invalidInstance['35']['1'][0]['18']['1'] = packedValue(Array(99).fill(0));
    partial['1']['25']['1']['100']['1']['1'][0]['2'].push(invalidInstance);
    await assert.rejects(importer.importSaveModuleGia(encode(partial)), rejectCode('invalidLength'));
    const unrelated = fixture(zeros(), '其他整数列表');
    await assert.rejects(importer.importSaveModuleGia(encode(unrelated)), rejectCode('notFound'));
    const nonSave = fixture(); nonSave['1']['5'] = 70;
    await assert.rejects(importer.importSaveModuleGia(encode(nonSave)), rejectCode('notFound'));
    const nonStruct = fixture(); nonStruct['1']['25']['1']['100']['1']['1'][0]['2'][0]['1'] = 3;
    await assert.rejects(importer.importSaveModuleGia(encode(nonStruct)), rejectCode('notFound'));
    const nestedDecoy = { '1': { '5': 41, '99': fixture()['1']['25'] } };
    await assert.rejects(importer.importSaveModuleGia(encode(nestedDecoy)), rejectCode('notFound'));
    for (const payload of [[128], Array(11).fill(128), [...Array(9).fill(255), 3]]) {
      const malformed = fixture(); stateField(malformed)['18']['1'] = 'base64:' + Buffer.from(payload).toString('base64');
      await assert.rejects(importer.importSaveModuleGia(encode(malformed)), rejectCode(['invalidFile', 'invalidList', 'int32Overflow']));
    }
    await assert.rejects(importer.importSaveModuleGia(allZeroBytes.subarray(0, allZeroBytes.length - 1)), rejectCode('invalidFile'));
    await assert.rejects(importer.importSaveModuleGia(Uint8Array.from([1, 2, 3])), rejectCode('invalidFile'));
    assert.throws(() => importer.readSaveModuleGia([]), rejectCode('invalidFile'));

    for (const filename of process.argv.slice(2)) {
      const result = await importer.importSaveModuleGia(fs.readFileSync(filename));
      assert.ok(result.candidates.length > 0);
      for (const candidate of result.candidates) {
        assert.equal(candidate.values.length, 100);
        assert.ok(candidate.values.every(value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647));
      }
      if (path.basename(filename) === '测试存档模版数据导出.gia') {
        assert.equal(result.candidates.length, 4);
        assert.deepEqual(result.candidates[0].values, [1, ...Array(99).fill(0)]);
        result.candidates.slice(1).forEach(candidate => assert.deepEqual(candidate.values, zeros()));
      }
      console.log(`PASS ${path.basename(filename)}: ${result.candidates.length} lists, each 100 signed int32 values`);
    }
    console.log('PASS save GIA schema matching, multiple structures/templates, zero preservation, signed int32 variants, offsets and malformed/overflow rejection');
  } finally {
    Module._load = oldLoad;
    if (oldTs) Module._extensions['.ts'] = oldTs; else delete Module._extensions['.ts'];
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
