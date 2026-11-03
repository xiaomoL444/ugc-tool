/* node scripts/test-dsfg-gil-ui-index-repair.cjs [sample.gil ...] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate, compileStyle } = require('@vue/compiler-sfc');

const root = path.resolve(__dirname, '..');
const base = path.join(root, 'src/views/DSFGStudio/components');
const originalTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
}).outputText, file);

const confirm = '[通用]确认提示_Default_UI', dialogue = '[对话]Dialog_Default_UI';
const targets = [
  ['Black_Screen_Script', 'Action_Dialog/TalkDialog/TalkStyles/Black_Screen_Script.lua', [confirm]],
  ['Dialog_Bottom_CG', 'Action_Dialog/TalkDialog/TalkStyles/Bottom_CG_Script.lua', [confirm]],
  ['Bottom_Dialog_Script.lua', 'Action_Dialog/TalkDialog/TalkStyles/Bottom_Dialog_Script.lua', [confirm]],
  ['Dialogue_Default_UI_Script', 'Action_Dialog/TalkDialog/TalkStyles/Default_UI_Script.lua', [confirm, dialogue]],
  ['Default', 'Message_Dialog/styles/Default.lua', [dialogue]],
];
const cat = (...parts) => Buffer.concat(parts.flat());
const varint = input => {
  let value = BigInt(input); const bytes = [];
  do { bytes.push(Number(value & 127n) | (value > 127n ? 128 : 0)); value >>= 7n; } while (value);
  return Buffer.from(bytes);
};
const int = (id, value) => cat(varint(BigInt(id) << 3n), varint(value));
const msg = (id, ...parts) => { const body = cat(...parts); return cat(varint((BigInt(id) << 3n) | 2n), varint(body.length), body); };
const str = (id, text) => msg(id, Buffer.from(text));
// Unknown fields contain duplicate integers, invalid UTF-8, a fixed64 and a NaN payload.
const opaque = cat(int(60, 1), int(60, 2), msg(61, Buffer.from([255, 128, 0])), varint(62 * 8 + 1), Buffer.alloc(8, 255), varint(63 * 8 + 5), Buffer.from([1, 0, 192, 127]));
function archive(body) {
  const header = Buffer.alloc(20); [body.length + 20, 1, 806, 2, body.length].forEach((n, i) => header.writeUInt32BE(n, i * 4));
  return cat(header, body, Buffer.from([0, 0, 6, 121, 222, 173, 190, 239]));
}
const control = (id, name, field = 502) => msg(field, int(501, id), msg(505, msg(12, str(501, name))), opaque);
function parameter(snapshot, name, value, type = 3) {
  return msg(snapshot, str(2, name), int(3, type), msg(4, int(1, 2), int(2, 1), msg(4, int(1, 1), msg(100, int(1, 3))), msg(102, int(1, value))), opaque);
}
function script(target, options = {}) {
  const [name, file, variables] = target, { values = {}, prefix = '', snapshots = [7, 8], type = 3 } = options;
  return msg(1, int(1, 123), str(2, name), str(3, prefix + file), str(5, '-- Lua source: 1073741858 must stay unchanged\n'),
    snapshots.flatMap(snapshot => variables.map(variable => parameter(snapshot, variable, values[variable] ?? 1, type))),
    parameter(7, '无关变量', 99), opaque);
}
function fixture(options = {}) {
  const { confirmIndex = 1073741858, dialogueIndex = 1073741869, controls = [], scripts, values, prefix, snapshots } = options;
  const ui = msg(9, control(confirmIndex, confirm), control(dialogueIndex, dialogue), controls,
    control(888, confirm, 501)); // A container entry with the same name is never a template candidate.
  const clientScripts = msg(50, scripts ?? targets.map(target => script(target, { values, prefix, snapshots })),
    script(['Default', 'Other/Default.lua', [dialogue]]), opaque);
  return archive(cat(opaque, clientScripts, ui, msg(25, Buffer.from([0, 255, 42])))); // Noncanonical field order is intentional.
}

async function main() {
  const { repairGilUiIndices: repair } = require(path.join(base, 'gilUiIndexRepair.ts'));
  let count = 0;
  async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
  await test('All six variables in five scripts and both snapshots repair; every unrelated byte is preserved', () => {
    const input = fixture(), original = Buffer.from(input), result = repair(input);
    assert.equal(result.rows.length, 6); assert.equal(result.rows.filter(row => row.changed).length, 6);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.rows.map(row => row.script), ['Black_Screen_Script', 'Dialog_Bottom_CG', 'Bottom_Dialog_Script.lua', 'Dialogue_Default_UI_Script', 'Dialogue_Default_UI_Script', 'Default']);
    assert.deepEqual(result.rows.map(row => row.index), [1073741858, 1073741858, 1073741858, 1073741858, 1073741869, 1073741869]);
    assert.deepEqual(Buffer.from(result.bytes), fixture({ values: { [confirm]: 1073741858, [dialogue]: 1073741869 } }));
    assert.deepEqual(input, original);
    const repeated = repair(result.bytes);
    assert.ok(repeated.rows.every(row => !row.changed)); assert.deepEqual(Buffer.from(repeated.bytes), Buffer.from(result.bytes));
  });
  await test('Imported script paths, singleton snapshots, ArrayBuffers and offset byte views work', () => {
    for (const snapshots of [[7], [8], [7, 8]]) {
      const input = fixture({ prefix: 'default_import_file/', snapshots });
      const expected = fixture({ prefix: 'default_import_file/', snapshots, values: { [confirm]: 1073741858, [dialogue]: 1073741869 } });
      const padded = cat(Buffer.alloc(17, 255), input, Buffer.alloc(11, 255));
      assert.deepEqual(Buffer.from(repair(padded.subarray(17, 17 + input.length)).bytes), expected);
      assert.deepEqual(Buffer.from(repair(Uint8Array.from(input).buffer).bytes), expected);
    }
  });
  await test('Varint length growth and shrinkage update all ancestor lengths and preserve trailers', () => {
    for (const [confirmIndex, dialogueIndex, old] of [[1, 127, 2147483647], [2147483647, 16384, 0]]) {
      const input = fixture({ confirmIndex, dialogueIndex, values: { [confirm]: old, [dialogue]: old } });
      const result = repair(input);
      assert.deepEqual(Buffer.from(result.bytes), fixture({ confirmIndex, dialogueIndex, values: { [confirm]: confirmIndex, [dialogue]: dialogueIndex } }));
      assert.ok(repair(result.bytes).rows.every(row => !row.changed));
    }
  });
  await test('Duplicate template indices deduplicate; conflicting or missing templates cannot produce a download', () => {
    assert.equal(repair(fixture({ controls: [control(1073741858, confirm)] })).rows.length, 6);
    assert.throws(() => repair(fixture({ controls: [control(1073741859, confirm)] })), /多个同名索引/);
    assert.throws(() => repair(fixture({ confirmIndex: 0 })), /索引无效/);
    assert.throws(() => repair(archive(msg(50, script(targets[0])))), /未找到客户端控件/);
    assert.throws(() => repair(fixture({ scripts: [] })), /未找到可修复/);
  });
  await test('Default matches only its exact path; missing, duplicate and unsupported scripts are reported and skipped', () => {
    const result = repair(fixture({ scripts: [script(targets[0]), script(['Default', 'Other/Default.lua', [dialogue]])] }));
    assert.equal(result.rows.length, 1); assert.equal(result.warnings.length, 4); assert.match(result.warnings.at(-1), /Message_Dialog\/styles\/Default.lua/);
    const duplicate = repair(fixture({ scripts: [script(targets[0]), script(targets[0]), script(targets[1], { type: 4 }), script(targets[4])] }));
    assert.equal(duplicate.rows.length, 1); assert.equal(duplicate.rows[0].script, 'Default');
    assert.ok(duplicate.warnings.some(warning => /存在多个脚本/.test(warning)));
    assert.ok(duplicate.warnings.some(warning => /格式不受支持/.test(warning)));
  });
  await test('Missing variables and duplicate parameter names never invent or partially rewrite a variable', () => {
    const incomplete = msg(1, str(2, targets[0][0]), str(3, targets[0][1]), opaque);
    const ambiguous = msg(1, str(2, targets[1][0]), str(3, targets[1][1]), parameter(7, confirm, 1), parameter(7, confirm, 2), parameter(8, confirm, 3));
    const result = repair(fixture({ scripts: [incomplete, ambiguous, script(targets[4])] }));
    assert.equal(result.rows.length, 1); assert.ok(result.warnings.some(warning => /变量.*未找到/.test(warning)));
    assert.deepEqual(Buffer.from(result.bytes), fixture({ scripts: [incomplete, ambiguous, script(targets[4], { values: { [dialogue]: 1073741869 } })] }));
  });
  await test('Truncated archives, malformed wire fields and invalid lengths are rejected', () => {
    const valid = fixture();
    for (const input of [new Uint8Array(), valid.subarray(0, 23), valid.subarray(0, valid.length - 5), archive(Buffer.from([0])), archive(Buffer.from([14])), archive(Buffer.from([10, 127, 0])), archive(Buffer.from([8, ...Array(11).fill(255)]))]) {
      assert.throws(() => repair(input), /损坏|格式不受支持/);
    }
    const badHeader = Buffer.from(valid); badHeader.writeUInt32BE(1, 0); assert.throws(() => repair(badHeader));
  });
  await test('The workspace settings and repair component compile with valid templates and styles', () => {
    for (const file of ['WorkspaceStructIdSettings.vue', 'WorkspaceGilUiIndexRepair.vue']) {
      const filename = path.join(base, file), { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
      assert.deepEqual(errors, []);
      const script = compileScript(descriptor, { id: 'repair-check' });
      assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'repair-check', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
      for (const style of descriptor.styles) assert.deepEqual(compileStyle({ source: style.content, filename, id: 'repair-check', scoped: style.scoped }).errors, []);
    }
  });
  await test('The repair panel handles cancellation, validation, errors, busy state and Blob URL cleanup', async () => {
    const filename = path.join(base, 'WorkspaceGilUiIndexRepair.vue');
    const descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor;
    const source = descriptor.scriptSetup.content.replace(/^import .*$/gm, '') + '\nreturn { readFile, busy, error, result, downloadUrl, fileName, changedCount };';
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const urls = [], revoked = [], events = [], cleanup = [];
    const props = { disabled: false };
    const factory = new Function('ref', 'computed', 'onBeforeUnmount', 'defineProps', 'defineEmits', 'URL', 'require', compiled);
    const ui = factory(vue.ref, vue.computed, fn => cleanup.push(fn), () => props, () => (...event) => events.push(event),
      { createObjectURL(blob) { urls.push(blob); return `blob:${urls.length}`; }, revokeObjectURL(url) { revoked.push(url); } },
      name => { assert.equal(name, './gilUiIndexRepair'); return { repairGilUiIndices: repair }; });
    const event = (name, bytes, size = bytes?.length) => ({ target: { value: 'chosen', files: name ? [{ name, size, async arrayBuffer() { return bytes; } }] : [] } });
    const cancelled = event(); await ui.readFile(cancelled); assert.equal(cancelled.target.value, ''); assert.deepEqual(events, []);
    await ui.readFile(event('bad.txt', fixture())); assert.match(ui.error.value, /\.gil/); assert.equal(urls.length, 0);
    await ui.readFile(event('big.gil', fixture(), 101 * 1024 * 1024)); assert.match(ui.error.value, /100 MB/);
    props.disabled = true; await ui.readFile(event('disabled.gil', fixture())); assert.equal(urls.length, 0); props.disabled = false;
    await ui.readFile(event('test.GIL', fixture()));
    assert.equal(ui.error.value, ''); assert.equal(ui.changedCount.value, 6); assert.equal(ui.fileName.value, 'test_已修复索引.gil');
    assert.equal(ui.downloadUrl.value, 'blob:1'); assert.equal(ui.busy.value, false);
    assert.deepEqual(Buffer.from(await urls[0].arrayBuffer()), Buffer.from(repair(fixture()).bytes));
    await ui.readFile(event('broken.gil', new Uint8Array([1]))); assert.ok(ui.error.value); assert.equal(ui.result.value, undefined);
    assert.equal(ui.downloadUrl.value, ''); assert.deepEqual(revoked, ['blob:1']);
    await ui.readFile(event('correct.gil', repair(fixture()).bytes)); assert.equal(ui.changedCount.value, 0); assert.equal(ui.downloadUrl.value, '');
    await ui.readFile(event('again.gil', fixture())); cleanup.forEach(fn => fn()); assert.deepEqual(revoked, ['blob:1', 'blob:2']);
    assert.deepEqual(events.slice(-2), [['busy', true], ['busy', false]]);
  });
  for (const filename of process.argv.slice(2)) await test(`Real GIL preserves unrelated data and every repaired index is stable: ${path.basename(filename)}`, async () => {
    const { decode } = await import('genshin-impact-ugc-file-converter-web');
    const input = fs.readFileSync(filename), original = Buffer.from(input), result = repair(input);
    assert.equal(result.rows.length, 6); assert.deepEqual(result.warnings, []); assert.equal(result.ui.length, 2);
    const before = decode(input, { type: 'gil' }), after = decode(result.bytes, { type: 'gil' });
    // Independently compare decoded documents after restoring only the twelve known parameter slots.
    const entries = value => Array.isArray(value) ? value : value ? [value] : [];
    const text = value => typeof value === 'string' ? value.startsWith('base64:') ? Buffer.from(value.slice(7), 'base64').toString('utf8') : value.replace(/^string:/, '') : '';
    const previousScripts = entries(before.json['50']['1']);
    for (const script of entries(after.json['50']['1'])) {
      const old = previousScripts.find(old => text(old['3']) === text(script['3']));
      for (const snapshot of ['7', '8']) for (let i = 0; i < entries(script[snapshot]).length; i++) {
        const parameter = entries(script[snapshot])[i], oldParam = entries(old[snapshot])[i];
        const row = result.rows.find(row => row.path === text(script['3']) && row.variable === text(parameter['2']));
        if (row) { assert.equal(parameter['4']['102']['1'], row.index); parameter['4']['102']['1'] = oldParam['4']['102']['1']; }
      }
    }
    assert.deepEqual(after, before); assert.deepEqual(input, original);
    const stable = repair(result.bytes); assert.ok(stable.rows.every(row => !row.changed)); assert.deepEqual(Buffer.from(stable.bytes), Buffer.from(result.bytes));
    console.log(`  ${result.rows.filter(row => row.changed).length} variables changed; ${result.ui.map(ui => `${ui.name}=${ui.index}`).join(', ')}`);
  });
  console.log(`\n${count} GIL UI index repair checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
});
