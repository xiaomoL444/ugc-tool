const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');

// Execute maintained source codecs and composables without generating build artifacts.
const originalLoad = Module._load;
const originalTs = Module._extensions['.ts'];
let context;
Module._load = function(request, parent, main) {
  if (request === 'vue') return { ...vue, inject: key => context?.[key], onMounted: fn => context.mount.push(fn), onBeforeUnmount: fn => context.unmount.push(fn) };
  if (request === '../../i18n') return { t: key => key };
  return originalLoad.call(this, request, parent, main);
};
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
}).outputText, file);

async function main() {
  const base = path.resolve(__dirname, '../src/views/DSFGStudio/components/EntityPresetEditor');
  const {
    SAVE_INTEGER_COUNT, SAVE_BIT_COUNT, createSaveModule, createSaveModuleField, encodeSaveModules: encode, decodeSaveModules: decode,
    getSaveFieldCapacity: capacity, getSaveFieldRange: range, validateSaveModule: validate, validateSaveModules: validateAll,
    readSaveFieldValue: read, writeSaveFieldValue: write,
    formatSaveIntegerBinary: integerBinary, formatSaveBinary: binary, getSaveFieldBitLength: bitLength, getSaveFieldBinary: fieldBinary,
  } = require(path.join(base, 'saveModules.ts'));
  const { useSaveModules } = require(path.join(base, 'useSaveModules.ts'));
  const { systemPresetConfig } = require(path.join(base, 'systemPresetConfig.ts'));
  const zeros = () => Array(SAVE_INTEGER_COUNT).fill(0);
  const field = { ...createSaveModuleField(), name: '跨整数任务状态', startBit: 60, length: 8, max: '255' };
  const module = { ...createSaveModule(), name: '任务存档', fields: [field] };
  const legacy = presets => JSON.stringify({ kind: 'DSFGSaveModules', schemaVersion: 1, presets }, null, 3);
  const oldField = { id: 'old-field', name: '旧任务状态', integerIndex: 1, startBit: 4, endBit: 7, min: 0, max: 15 };
  assert.equal(SAVE_INTEGER_COUNT, 100);
  assert.equal(SAVE_BIT_COUNT, 3200);
  assert.equal(JSON.parse(encode([module])).schemaVersion, 2);
  assert.notEqual(createSaveModule().id, module.id);
  assert.notEqual(createSaveModuleField().id, field.id);
  const defaultField = createSaveModuleField();
  assert.deepEqual(defaultField, { ...systemPresetConfig.saveModules.newField, id: defaultField.id });
  assert.deepEqual(decode(encode([module])), [module]);
  assert.throws(() => decode(encode([module, module])));
  assert.throws(() => decode(encode([{ ...module, fields: [field, field] }])));
  for (const raw of ['', '{}', 'null', '{"kind":"DSFGSaveModules","schemaVersion":3,"presets":[]}']) assert.throws(() => decode(raw));
  for (const key of ['startBit', 'length']) for (const invalid of [null, '0', [], {}]) {
    assert.throws(() => decode(encode([{ ...module, fields: [{ ...field, [key]: invalid }] }])));
  }
  for (const key of ['min', 'max']) for (const invalid of [null, 0, [], {}]) {
    assert.throws(() => decode(encode([{ ...module, fields: [{ ...field, [key]: invalid }] }])));
  }
  assert.throws(() => decode(encode([{ ...module, fields: null }])));
  assert.throws(() => decode(encode([{ ...module, fields: [{ ...field, legacyLocation: {} }] }])));
  assert.deepEqual(decode(encode([{ id: 'older' }])), [{ id: 'older', ...systemPresetConfig.saveModules.newItem }]);
  assert.deepEqual(decode(encode([{ ...module, fields: [{ id: 'earlier', name: '保留名称' }] }]))[0].fields[0], {
    ...systemPresetConfig.saveModules.newField, id: 'earlier', name: '保留名称',
  });
  const independent = createSaveModule();
  independent.fields.push(field);
  assert.equal(systemPresetConfig.saveModules.newItem.fields.length, 0);
  console.log('PASS schema2 codecs, exact string ranges, centralized defaults, unique IDs and corrupt-data protection');

  assert.deepEqual(decode(legacy([{ ...module, fields: [oldField] }]))[0].fields[0], {
    id: oldField.id, name: oldField.name, startBit: 36, length: 4, min: '0', max: '15',
  });
  assert.deepEqual(decode(legacy([{ id: 'legacy-default', fields: [{ id: 'legacy-default-field' }] }]))[0].fields[0], {
    ...systemPresetConfig.saveModules.newField, id: 'legacy-default-field', startBit: 0,
  });
  for (let low = 0; low <= 31; low++) for (let high = low; high <= 31; high++) {
    const max = 2 ** (high - low + 1) - 1;
    const migrated = decode(legacy([{ ...module, fields: [{ ...oldField, startBit: low, endBit: high, max }] }]))[0].fields[0];
    assert.equal(migrated.startBit, 32 + low);
    assert.equal(migrated.length, high - low + 1);
    assert.equal(migrated.min, migrated.length === 32 ? '-2147483648' : '0');
    assert.equal(migrated.max, migrated.length === 32 ? '2147483647' : String(max));
    for (const source of [0, -1, -2147483648, 2147483647, 0x12345678]) {
      const values = zeros(); values[1] = source;
      const stored = (BigInt.asUintN(32, BigInt(source)) >> BigInt(low)) & BigInt(max);
      const expected = migrated.length === 32 ? BigInt.asIntN(32, stored) : stored;
      assert.equal(read(values, migrated), expected.toString());
    }
  }
  for (const invalid of [
    { integerIndex: -1 }, { integerIndex: 100 }, { integerIndex: 1.5 },
    { startBit: -1 }, { endBit: 32 }, { startBit: 8, endBit: 4 }, { endBit: 7.5 },
  ]) {
    const original = { ...oldField, ...invalid };
    const migrated = decode(legacy([{ ...module, fields: [original] }]))[0].fields[0];
    assert.equal(migrated.startBit, -1, 'Invalid legacy coordinates cannot silently become valid global spans');
    assert.deepEqual(migrated.legacyLocation, { integerIndex: original.integerIndex, startBit: original.startBit, endBit: original.endBit });
    assert.equal(migrated.id, oldField.id); assert.equal(migrated.name, oldField.name);
    assert.ok(validate({ ...module, fields: [migrated] }).length);
    assert.throws(() => read(zeros(), migrated));
    assert.deepEqual(decode(encode([{ ...module, fields: [migrated] }]))[0].fields[0], migrated);
  }
  for (const invalid of [{ min: -1 }, { max: 1.5 }, { min: 17, max: 15 }]) {
    const migrated = decode(legacy([{ ...module, fields: [{ ...oldField, ...invalid }] }]))[0].fields[0];
    for (const key of Object.keys(invalid)) assert.equal(migrated[key], String(invalid[key]));
    assert.ok(validate({ ...module, fields: [migrated] }).length);
    assert.equal(read(zeros(), migrated), '0', 'Bad declared ranges must not hide source preview');
  }
  console.log('PASS all 528 legacy local intervals, exact v1 range migration and preserved invalid coordinate/range drafts');

  assert.equal(integerBinary(0), '0'.repeat(32));
  assert.equal(integerBinary(1), '1' + '0'.repeat(31));
  assert.equal(integerBinary(2), '01' + '0'.repeat(30));
  assert.equal(integerBinary(3), '11' + '0'.repeat(30));
  assert.equal(integerBinary(-1), '1'.repeat(32));
  assert.equal(integerBinary(-2147483648), '0'.repeat(31) + '1');
  assert.equal(integerBinary(2147483647), '1'.repeat(31) + '0');
  assert.equal(integerBinary(0x12345678), '00011110011010100010110001001000');
  const firstLowBit = zeros(); firstLowBit[0] = 1;
  assert.equal(read(firstLowBit, { ...field, startBit: 0, length: 1, max: '1' }), '1', 'The leftmost bit zero must read the source integer low bit');
  const ordering = zeros(); ordering[0] = -2147483648; ordering[1] = 1; ordering[99] = -1;
  assert.equal(binary(ordering).length, 3200);
  assert.equal(binary(ordering), integerBinary(-2147483648) + integerBinary(1) + '0'.repeat(97 * 32) + '1'.repeat(32));
  const boundary = { ...field, startBit: 31, length: 2, max: '3' };
  assert.equal(fieldBinary(ordering, boundary), '11'); assert.equal(read(ordering, boundary), '3');
  const boundaryLow = zeros(); boundaryLow[0] = -2147483648;
  const boundaryHigh = zeros(); boundaryHigh[1] = 1;
  assert.equal(fieldBinary(boundaryLow, boundary), '10'); assert.equal(read(boundaryLow, boundary), '1');
  assert.equal(fieldBinary(boundaryHigh, boundary), '01'); assert.equal(read(boundaryHigh, boundary), '2');
  const resetBoundary = write(ordering, boundary, '0');
  assert.equal(resetBoundary[0], 0); assert.equal(resetBoundary[1], 0); assert.equal(resetBoundary[99], -1);
  assert.deepEqual(ordering.slice(0, 2), [-2147483648, 1], 'Write must not mutate source integers');
  const all32 = { ...field, startBit: 0, length: 32, min: '-2147483648', max: '2147483647' };
  assert.deepEqual(range(all32), { min: '-2147483648', max: '2147483647' });
  assert.equal(capacity(all32), '2147483647');
  const signed = zeros(); signed[0] = -1;
  assert.equal(read(signed, all32), '-1'); assert.equal(fieldBinary(signed, all32), '1'.repeat(32));
  for (const value of [-2147483648, -1, 0, 2147483647]) for (const replacement of [value, String(value), BigInt(value)]) {
    const result = write(zeros(), all32, replacement);
    assert.equal(result[0], value); assert.equal(read(result, all32), String(value));
    assert.equal(fieldBinary(result, all32), integerBinary(value));
  }
  for (const value of ['-2147483649', '2147483648', '4294967295', -2147483649, 2147483648, -2147483649n, 2147483648n, '-1.5', '--1', '+1', ' -1', '-1\n', '-']) {
    assert.throws(() => write(zeros(), all32, value), 'Signed 32-bit writes must reject out-of-range or malformed integers');
  }
  assert.equal(write(signed, { ...all32, length: 1, min: '0', max: '1' }, '0')[0], -2);
  assert.equal(write(zeros(), { ...all32, length: 1, min: '0', max: '1' }, 1)[0], 1);
  for (const length of [1, 31, 33, 64]) {
    const current = { ...field, startBit: 0, length, min: '0', max: ((1n << BigInt(length)) - 1n).toString() };
    assert.deepEqual(range(current), { min: '0', max: current.max }); assert.equal(capacity(current), current.max);
    assert.equal(read(Array(100).fill(-1), current), current.max);
    assert.throws(() => write(zeros(), current, '-1')); assert.throws(() => write(zeros(), current, -1));
    assert.ok(validate({ ...module, fields: [{ ...current, min: '-1' }] }).length);
  }

  const sources = [zeros(), Array(100).fill(-1), Array.from({ length: 100 }, (_, index) => [0, 1, -1, -2147483648, 2147483647, 0x12345678, -123456789][index % 7])];
  const spans = [[0, 1], [0, 31], [0, 32], [3, 32], [31, 32], [3168, 32], [0, 33], [31, 2], [28, 8], [60, 80], [10, 140], [31, 65], [32, 64], [3199, 1], [3170, 30], [0, 3200]];
  for (const [startBit, length] of spans) {
    const mask = (1n << BigInt(length)) - 1n;
    const isSigned = length === 32;
    const current = { ...field, startBit, length, min: isSigned ? '-2147483648' : '0', max: isSigned ? '2147483647' : mask.toString() };
    const shift = BigInt(startBit);
    assert.equal(bitLength(current), length); assert.equal(capacity(current), current.max);
    for (const values of sources) {
      const source = values.reduce((result, value, index) => result | (BigInt.asUintN(32, BigInt(value)) << BigInt(index * 32)), 0n);
      const stored = (source >> shift) & mask;
      assert.equal(read(values, current), (isSigned ? BigInt.asIntN(32, stored) : stored).toString());
      assert.equal(fieldBinary(values, current), binary(values).slice(startBit, startBit + length));
      for (const replacement of isSigned ? [-2147483648n, -1n, 0n, 2147483647n] : [0n, mask, mask / 3n]) {
        const result = write(values, current, replacement.toString());
        const storedReplacement = isSigned ? BigInt.asUintN(32, replacement) : replacement;
        const expected = (source & ~(mask << shift)) | (storedReplacement << shift);
        assert.equal(binary(result), expected.toString(2).padStart(3200, '0').split('').reverse().join(''));
        assert.equal(read(result, current), replacement.toString());
        assert.notEqual(result, values);
        for (let index = 0; index < 100; index++) {
          if (index * 32 >= startBit + length || (index + 1) * 32 <= startBit) assert.equal(result[index], values[index]);
        }
      }
    }
  }
  const wide = { ...field, startBit: 29, length: 100, max: ((1n << 100n) - 1n).toString() };
  const exact = '1267650600228229401496703205373';
  assert.equal(read(write(zeros(), wide, exact), wide), exact);
  assert.equal(read(write(zeros(), wide, BigInt(exact)), wide), exact);
  assert.equal(read(write(zeros(), wide, Number.MAX_SAFE_INTEGER), wide), String(Number.MAX_SAFE_INTEGER));
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Number(exact), -1, '-1', '1.5', '1e3', ' 1 ', '1\n', 1.5, NaN, Infinity, '', null]) assert.throws(() => write(zeros(), wide, value));
  assert.throws(() => write(zeros(), wide, (1n << 100n).toString()));
  const full = { ...field, startBit: 0, length: 3200, max: ((1n << 3200n) - 1n).toString() };
  assert.deepEqual(write(zeros(), full, full.max), Array(100).fill(-1));
  assert.equal(read(Array(100).fill(-1), full), full.max);
  for (const source of [-2147483649, 2147483648, 0.5, NaN, Infinity]) {
    const invalid = zeros(); invalid[99] = source;
    assert.throws(() => binary(invalid)); assert.throws(() => read(invalid, field));
    assert.throws(() => write(invalid, field, '0')); assert.throws(() => fieldBinary(invalid, field)); assert.throws(() => integerBinary(source));
  }
  for (const invalid of [[], zeros().slice(1), [...zeros(), 0], new Array(100), null]) {
    assert.throws(() => binary(invalid)); assert.throws(() => read(invalid, field)); assert.throws(() => write(invalid, field, '0'));
  }
  const bounded = { ...field, min: '3', max: '10' };
  assert.equal(read(zeros(), bounded), '0'); assert.equal(fieldBinary(zeros(), bounded), '00000000');
  assert.throws(() => write(zeros(), bounded, '2')); assert.equal(read(write(zeros(), bounded, '10'), bounded), '10');
  const signedBounded = { ...all32, startBit: 29, min: '-10', max: '10' };
  assert.deepEqual(validate({ ...module, fields: [signedBounded] }), []);
  for (const value of ['-10', '-1', '0', '10']) assert.equal(read(write(zeros(), signedBounded, value), signedBounded), value);
  for (const value of ['-11', '11']) assert.throws(() => write(zeros(), signedBounded, value));
  for (const invalid of [{ min: '-2147483649' }, { max: '2147483648' }, { min: '1', max: '4294967295' }, { min: '-1.5' }, { min: '0', max: '-1' }]) {
    const draft = { ...all32, ...invalid };
    assert.ok(validate({ ...module, fields: [draft] }).length);
    assert.deepEqual(decode(encode([{ ...module, fields: [draft] }]))[0].fields[0], draft, 'Invalid signed range drafts must preserve source text');
    assert.throws(() => write(zeros(), draft, '0'));
    assert.equal(read(signed, draft), '-1', 'Invalid configured ranges must not hide signed source previews');
  }
  const oldUnsigned32 = decode(legacy([{ ...module, fields: [{ ...oldField, startBit: 0, endBit: 31, min: 0, max: 4294967295 }] }]))[0].fields[0];
  assert.deepEqual([oldUnsigned32.min, oldUnsigned32.max], ['-2147483648', '2147483647']);
  assert.deepEqual(validate({ ...module, fields: [oldUnsigned32] }), []);
  assert.equal(read(Array(100).fill(-1), oldUnsigned32), '-1');
  const oldGlobalFull32 = { ...all32, startBit: 29, min: '0', max: '4294967295' };
  assert.deepEqual(decode(encode([{ ...module, fields: [oldGlobalFull32] }]))[0].fields[0], {
    ...oldGlobalFull32, min: '-2147483648', max: '2147483647',
  }, 'Known old full unsigned 32-bit ranges migrate to signed full range in schema2 as well');
  for (const unchanged of [
    { ...oldGlobalFull32, min: '00' }, { ...oldGlobalFull32, max: '04294967295' },
    { ...oldGlobalFull32, min: '1' }, { ...oldGlobalFull32, max: '4294967294' },
    { ...oldGlobalFull32, startBit: 3190 }, { ...oldGlobalFull32, length: 33 },
    { ...oldGlobalFull32, min: '-10', max: '10' }, { ...oldGlobalFull32, max: '100' },
  ]) assert.deepEqual(decode(encode([{ ...module, fields: [unchanged] }]))[0].fields[0], unchanged,
    'Custom, malformed, non-32-bit and invalid-location definitions must not be mistaken for the old known full range');
  console.log('PASS LSB-first integers, bit-zero reads, list concatenation, 31/32 boundary, signed Int32 conversion and full 3200-bit streams');
  console.log('PASS exactly-32-bit signed ranges and two-complement read/write across integer boundaries; 1/31/33/64-bit unsigned behavior retained');
  console.log('PASS exact >53-bit decimal read/write, independent BigInt oracle, strict input lists and preservation of all unrelated bits');

  assert.deepEqual(validate(module), []);
  const overlap = { ...field, id: 'overlap', name: '重叠', startBit: 67, length: 2, max: '3' };
  assert.deepEqual(new Set(validate({ ...module, fields: [field, overlap] }).map(issue => issue.fieldId)), new Set([field.id, overlap.id]));
  const adjacent = { ...overlap, startBit: 68 };
  assert.deepEqual(validate({ ...module, fields: [field, adjacent] }), []);
  for (const invalid of [
    { startBit: -1 }, { startBit: 3200 }, { startBit: 0.5 }, { length: 0 }, { length: -1 }, { length: 1.5 }, { length: 3200 },
    { min: '-1' }, { min: '256' }, { max: '256' }, { max: '1.5' }, { min: '' }, { max: '1e3' },
  ]) {
    const draft = { ...module, fields: [{ ...field, ...invalid }] };
    assert.ok(validate(draft).length);
    assert.deepEqual(decode(encode([draft])), [draft], 'Semantic errors remain saveable drafts');
    assert.throws(() => write(zeros(), draft.fields[0], '0'));
    if ('startBit' in invalid || 'length' in invalid) {
      assert.throws(() => read(zeros(), draft.fields[0])); assert.throws(() => bitLength(draft.fields[0])); assert.throws(() => fieldBinary(zeros(), draft.fields[0]));
    } else assert.equal(read(zeros(), draft.fields[0]), '0');
  }
  const other = { ...module, id: 'other-module', name: '奖励存档', fields: [overlap] };
  const globalIssues = validateAll([module, other]);
  assert.equal(globalIssues.length, 2);
  assert.deepEqual(globalIssues.map(issue => [issue.moduleId, issue.fieldId]), [[module.id, field.id], [other.id, overlap.id]]);
  assert.ok(globalIssues[0].message.includes(other.name)); assert.ok(globalIssues[0].message.includes(overlap.name));
  assert.deepEqual(validateAll([module, { ...other, fields: [adjacent] }]), []);
  assert.equal(validateAll([module, { ...other, fields: [{ ...overlap, startBit: -1 }] }]).length, 1);
  assert.ok(validateAll([module, { ...other, id: module.id, fields: [adjacent] }]).some(issue => issue.message.includes('模块 ID 重复')));
  assert.ok(validateAll([module, { ...other, fields: [{ ...adjacent, id: field.id }] }]).some(issue => issue.message.includes('字段 ID 重复')));
  console.log('PASS global range validation, adjacent spans, cross-integer/cross-module collisions, IDs and lossless invalid drafts');

  const files = new Map();
  let fail = false;
  const storage = { setProject() { return this; }, async exists(file) { return files.has(file); },
    async readFile(file) { return files.get(file); }, async writeFile(file, data) { if (fail) throw Error('save failed'); files.set(file, data); } };
  async function mount(workspace) {
    context = { storage, selectedWorkspaceId: vue.ref(workspace), mount: [], unmount: [] };
    const scope = vue.effectScope(); const instance = scope.run(() => useSaveModules());
    const hooks = context; await hooks.mount[0]();
    return { instance, hooks, close: () => { hooks.unmount[0](); scope.stop(); } };
  }
  const first = await mount('A');
  assert.equal(first.instance.ready.value, true); assert.equal(files.size, 0);
  first.hooks.selectedWorkspaceId.value = 'B'; first.instance.presets.value.push(module); await first.instance.flush();
  assert.deepEqual(decode(files.get('/A/SaveModules.json')), [module]);
  assert.equal(JSON.parse(files.get('/A/SaveModules.json')).presetStorage, 'custom-only'); assert.equal(files.has('/B/SaveModules.json'), false);
  const consumer = await mount('A'); first.instance.presets.value[0].name = '同步预览'; await first.instance.flush();
  assert.equal(consumer.instance.availablePresets.value[0].name, '同步预览'); consumer.close();
  fail = true; first.instance.presets.value[0].name = '重试保存'; await assert.rejects(first.instance.flush());
  fail = false; await first.instance.retry(); first.close();
  const reopened = await mount('A'); assert.equal(reopened.instance.presets.value[0].name, '重试保存'); reopened.close();
  const corrupt = 'broken original bytes'; files.set('/Broken/SaveModules.json', corrupt);
  const broken = await mount('Broken'); assert.equal(broken.instance.ready.value, false); assert.ok(broken.instance.error.value);
  await broken.instance.flush(); assert.equal(files.get('/Broken/SaveModules.json'), corrupt); broken.close();
  const legacyRaw = legacy([{ ...module, fields: [oldField, { ...oldField, id: 'old-invalid', integerIndex: 1.5 }] }]);
  files.set('/Migration/SaveModules.json', legacyRaw);
  const migratedWorkspace = await mount('Migration');
  assert.equal(migratedWorkspace.instance.presets.value[0].fields[0].startBit, 36);
  assert.equal(migratedWorkspace.instance.presets.value[0].fields[1].startBit, -1);
  await migratedWorkspace.instance.flush();
  assert.equal(files.get('/Migration/SaveModules.json'), legacyRaw, 'On-load migration must leave original v1 bytes unchanged');
  migratedWorkspace.instance.presets.value[0].name = '显式编辑后保存'; await migratedWorkspace.instance.flush();
  assert.equal(JSON.parse(files.get('/Migration/SaveModules.json')).schemaVersion, 2);
  assert.deepEqual(decode(files.get('/Migration/SaveModules.json'))[0].fields, decode(legacyRaw)[0].fields);
  migratedWorkspace.close();
  const oldSignedRaw = JSON.stringify({ kind: 'DSFGSaveModules', schemaVersion: 2, presetStorage: 'custom-only',
    presets: [{ ...module, fields: [oldGlobalFull32] }] }, null, 3);
  files.set('/SignedMigration/SaveModules.json', oldSignedRaw);
  const signedMigration = await mount('SignedMigration');
  assert.deepEqual([signedMigration.instance.presets.value[0].fields[0].min, signedMigration.instance.presets.value[0].fields[0].max], ['-2147483648', '2147483647']);
  await signedMigration.instance.flush(); assert.equal(files.get('/SignedMigration/SaveModules.json'), oldSignedRaw,
    'Recognizing an old full 32-bit range on load must preserve original bytes until an explicit definition edit');
  signedMigration.instance.presets.value[0].name = '明确编辑后保存有符号范围'; await signedMigration.instance.flush();
  assert.deepEqual([decode(files.get('/SignedMigration/SaveModules.json'))[0].fields[0].min, decode(files.get('/SignedMigration/SaveModules.json'))[0].fields[0].max], ['-2147483648', '2147483647']);
  signedMigration.close();

  const originalDefaults = systemPresetConfig.saveModules.presets.splice(0, systemPresetConfig.saveModules.presets.length, { ...module, id: 'system-save' });
  try {
    const systems = await mount('defaults');
    assert.ok(vue.isReadonly(systems.instance.systemPresets.value[0])); assert.deepEqual(systems.instance.customPresets.value, []);
    systems.instance.presets.value.push(module); await systems.instance.flush();
    assert.deepEqual(decode(files.get('/defaults/SaveModules.json')), [module]); assert.equal(systems.instance.availablePresets.value[0].id, 'system-save');
    systems.instance.presets.value = []; await systems.instance.flush(); assert.equal(systems.instance.availablePresets.value.length, 1); systems.close();
    files.set('/legacy/SaveModules.json', encode([{ ...module, id: 'system-save', name: '用户编辑的旧系统存档' }]));
    const legacyWorkspace = await mount('legacy');
    assert.equal(legacyWorkspace.instance.systemPresets.value[0].name, module.name);
    assert.equal(legacyWorkspace.instance.customPresets.value[0].name, '用户编辑的旧系统存档');
    assert.equal(legacyWorkspace.instance.customPresets.value[0].id, 'custom:system-save'); legacyWorkspace.close();
  } finally { systemPresetConfig.saveModules.presets.splice(0, systemPresetConfig.saveModules.presets.length, ...originalDefaults); }
  console.log('PASS workspace isolation, refresh/retry, immutable defaults, v1 load without writes and corrupt-file preservation');

  const { createEditorHistory } = require(path.resolve(base, '../../../ClientUIAnimationEditor/editorHistory.ts'));
  const drafts = vue.ref(decode(legacyRaw));
  const history = createEditorHistory({ capture: () => JSON.stringify(drafts.value), restore: snapshot => { drafts.value = JSON.parse(snapshot); }, describe: () => '修改存档位段' });
  const before = JSON.stringify(drafts.value);
  history.begin('pointer');
  drafts.value[0].fields[0] = { ...wide, id: oldField.id, name: oldField.name };
  history.observe(JSON.stringify(drafts.value)); history.end('pointer');
  const after = JSON.stringify(drafts.value); assert.equal(history.entries.value.length, 1);
  await history.undo(); assert.equal(JSON.stringify(drafts.value), before);
  await history.redo(); assert.equal(JSON.stringify(drafts.value), after);
  assert.equal(drafts.value[0].fields[0].max, wide.max);
  history.dispose();
  console.log('PASS undo/redo snapshots preserve global spans, huge decimal ranges and invalid legacy coordinate evidence');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) Module._extensions['.ts'] = originalTs;
  else delete Module._extensions['.ts'];
});
