/* node scripts/test-dsfg-gil-skill-animations.cjs [imported.gil] [original.gia] */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

async function main() {
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, 'src/views/DSFGStudio/components');
  const converter = await import(pathToFileURL(path.join(root, 'vendor/genshin-impact-ugc-file-converter-web/dist/index.js')).href);
  const library = await import('miliastra-variable');
  const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
  let decodeCalls = 0;
  Module._load = function(request, parent, main) {
    if (request === 'genshin-impact-ugc-file-converter-web') return { ...converter, decode(...args) { decodeCalls++; return converter.decode(...args); } };
    if (request === 'miliastra-variable') return library;
    return originalLoad.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, main);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
  }).outputText, file);
  try {
    const api = require(path.join(base, 'gilSkillAnimations.ts'));
    const config = require(path.join(base, 'workspaceStructIds.ts'));
    const { systemPresetConfig } = require(path.join(base, 'EntityPresetEditor/systemPresetConfig.ts'));
    const defaults = config.createWorkspaceStructIds();
    const presets = systemPresetConfig.skillAnimations.presets.map(item => ({ ...item }));
    const skill = (id, name, type = 6) => ({ '1': id, '2': type, '4': [{ '1': 1, '11': { '1': `string:${name}` } }] });
    const encodeGil = json => converter.encode({ filetype: 'gil', dirtype: 'Unknown', info: { '1': 1, '2': 806, '3': 2, '4': 1657 }, dtype_csv: '', json });
    const freeze = value => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
      return value;
    };
    let count = 0;
    async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }

    await test('Only GIL skill definitions are read; graph references and other configuration types are ignored', () => {
      const valid = skill(501, '[演出]交谈-持续');
      const document = { json: {
        '10': { '1': [skill(999, '[演出]交谈-持续')], '6': [{ '1': { '1': 998, '501': 'string:[演出]交谈-持续' } }] },
        '15': { '1': [valid, valid, skill(502, '[演出]交谈-持续', 5), skill(503, '[演出]交谈-持续', '6')] },
        '20': { '1': valid },
      } };
      assert.deepEqual(api.readGilSkillTable(document), [{ id: '501', name: '[演出]交谈-持续' }]);
      assert.deepEqual(api.readGilSkillTable({ json: { '15': { '1': { ...valid, '4': valid['4'][0] } } } }), [{ id: '501', name: '[演出]交谈-持续' }]);
      for (const json of [null, [], {}, { '15': { '1': null } }, { '15': [valid] }]) assert.deepEqual(api.readGilSkillTable({ json }), []);
    });
    await test('Skill IDs must be positive Int32 integers and equivalent ID spellings are deduplicated', () => {
      const entries = [skill(1, 'A'), skill('0001', 'A'), skill(2147483647, 'B')];
      for (const id of [0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '', ' ', '1e3', '1.0', 'int64:1', true, {}]) entries.push(skill(id, 'Invalid'));
      entries.push({ '1': 2, '2': 6, '4': [{ '1': 2, '11': { '1': 'string:Wrong component' } }] });
      entries.push({ '1': 3, '2': 6, '4': [{ '1': 1, '11': { '1': 42 } }] });
      entries.push({ '1': 4, '2': 6, '4': [{ '1': 1, '11': { '1': '' } }] });
      entries.push(skill(5, ' '));
      assert.deepEqual(api.readGilSkillTable({ json: { '15': { '1': entries } } }), [
        { id: '1', name: 'A' }, { id: '2147483647', name: 'B' },
      ]);
    });
    await test('Full names match precisely with only the two known performance prefixes accepted', () => {
      const current = [
        { id: 'talk', name: '交谈-持续', configId: '100' },
        { id: 'think', name: '思考-持续', configId: '101' },
        { id: 'custom', name: '自定义动画', configId: '102' },
        { id: 'prefixed', name: '[演出]耳语-持续', configId: '103' },
        { id: 'blank', name: '', configId: '104' },
        { id: 'whitespace', name: ' ', configId: '105' },
        { id: 'missing', name: '交谈-后摇', configId: '106' },
      ];
      const skills = [
        { id: '1', name: '[演出]交谈-持续' }, { id: '2', name: '[演岀]思考-持续' },
        { id: '3', name: '自定义动画' }, { id: '4', name: '[演岀]耳语-持续' },
        { id: '10', name: '[其他]交谈-持续' }, { id: '11', name: '[演出]交谈-持续-额外' },
        { id: '12', name: '[演出]交谈-后摇 ' }, { id: '13', name: '[演出]' },
      ];
      const result = api.matchGilSkillAnimationIds(skills, current);
      assert.deepEqual(result.matched, ['talk', 'think', 'custom', 'prefixed']);
      assert.deepEqual(result.missing, ['blank', 'whitespace', 'missing']);
      assert.deepEqual(result.ambiguous, []);
      assert.deepEqual(result.presets.map(item => item.configId), ['1', '2', '3', '4', '104', '105', '106']);
    });
    await test('Duplicate IDs remain unique; ambiguous or missing names retain the current preset ID', () => {
      const skills = freeze([
        { id: '01', name: '[演出]交谈-持续' }, { id: '1', name: '[演岀]交谈-持续' },
        { id: '2', name: '[演出]交谈-后摇' }, { id: '3', name: '[演出]交谈-后摇' },
        { id: '2', name: '[演出]交谈-后摇' }, { id: '0', name: '无效' },
      ]);
      const current = freeze([
        { id: 'unique', name: '交谈-持续', configId: '100' },
        { id: 'ambiguous', name: '交谈-后摇', configId: '101' },
        { id: '__proto__', name: '交谈-后摇', configId: '102' },
        { id: 'missing', name: '无效', configId: '103' },
      ]);
      const before = JSON.stringify([skills, current]);
      const result = api.matchGilSkillAnimationIds(skills, current);
      assert.deepEqual(result.matched, ['unique']);
      assert.deepEqual(result.ambiguous, ['ambiguous', '__proto__']);
      assert.deepEqual(result.missing, ['missing']);
      assert.deepEqual(result.presets.map(item => item.configId), ['1', '101', '102', '103']);
      assert.deepEqual(result.candidates.ambiguous.map(item => item.id), ['2', '3']);
      assert.deepEqual(result.candidates.__proto__.map(item => item.id), ['2', '3']);
      result.presets[0].configId = '999'; result.candidates.ambiguous[0].name = 'Changed';
      assert.equal(JSON.stringify([skills, current]), before);
      assert.ok(result.presets.every((item, index) => item !== current[index]));
    });
    await test('Workspace import decodes once and accepts skills-only, structs-only and empty valid GIL tables', () => {
      const current = [{ id: 'talk', name: '交谈-持续', configId: '100' }];
      const cases = [
        { json: { '15': { '1': [skill(501, '[演出]交谈-持续')] } }, structs: 0, skills: 1 },
        { json: { '10': { '6': [{ '1': { '1': 502, '501': 'string:[演出]对话' } }] } }, structs: 1, skills: 0 },
        { json: {}, structs: 0, skills: 0 },
      ];
      for (const entry of cases) {
        const bytes = encodeGil(entry.json), padded = new Uint8Array(bytes.length + 8);
        padded.set(bytes, 4);
        decodeCalls = 0;
        const result = api.importGilWorkspaceIds(padded.subarray(4, 4 + bytes.length), defaults, current);
        assert.equal(decodeCalls, 1);
        assert.equal(result.structs.matched.length, entry.structs);
        assert.equal(result.skills.matched.length, entry.skills);
        assert.equal(result.skills.presets[0].configId, entry.skills ? '501' : '100');
        assert.deepEqual(current, [{ id: 'talk', name: '交谈-持续', configId: '100' }]);
        assert.deepEqual(defaults, config.createWorkspaceStructIds());
      }
      decodeCalls = 0;
      assert.throws(() => api.importGilWorkspaceIds(new Uint8Array([1, 2, 3]), defaults, current));
      assert.equal(decodeCalls, 1, 'A malformed container must fail instead of being treated as missing tables');
    });

    const sources = process.argv.slice(2).map(file => ({ file, bytes: fs.readFileSync(file) }));
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const hashes = sources.map(source => hash(source.bytes));
    if (sources[0]) await test('The supplied imported GIL uniquely identifies all 37 system animations, with 36 changed IDs', () => {
      const table = api.readGilSkillTable(converter.decode(sources[0].bytes, { type: 'gil' }));
      assert.equal(table.length, 39);
      const before = JSON.stringify([defaults, presets]);
      decodeCalls = 0;
      const result = api.importGilWorkspaceIds(sources[0].bytes, defaults, presets);
      assert.equal(decodeCalls, 1);
      assert.equal(result.skills.matched.length, 37);
      assert.deepEqual(result.skills.missing, []); assert.deepEqual(result.skills.ambiguous, []);
      assert.equal(result.skills.presets.filter((item, index) => item.configId !== presets[index].configId).length, 36);
      const expected = {
        'skill-talk-loop': '1098907649', 'skill-talk-end': '1098907650',
        'skill-arms-crossed-loop': '1098907651', 'skill-arms-crossed-end': '1098907652',
        'skill-think-loop': '1098907677', 'skill-whisper-loop': '1098907679',
        'skill-walk-loop': '1098907682', 'skill-run-loop': '1098907683', 'skill-sprint-loop': '1098907684',
      };
      for (const [id, expectedId] of Object.entries(expected)) assert.equal(result.skills.presets.find(item => item.id === id).configId, expectedId);
      assert.equal(table.find(item => item.name === '[演出]玩家传送').id, '1098907681');
      assert.equal(table.find(item => item.name === '[演出]冲刺-后摇').id, '1098907687');
      assert.equal(JSON.stringify([defaults, presets]), before);
    });
    if (sources[1]) await test('The supplied original GIA independently confirms the original preset IDs and all 38 remapped skills', () => {
      const original = converter.decode(sources[1].bytes, { type: 'gia' });
      const entries = original.json['1'];
      assert.ok(Array.isArray(entries));
      const skills = entries.filter(entry => entry['15']?.['1']?.['2'] === 6).map(entry => {
        assert.equal(entry['5'], 8);
        assert.equal(entry['1']['4'], entry['15']['1']['1']);
        return { id: String(entry['15']['1']['1']), name: entry['3'].replace(/^string:/, '') };
      });
      assert.equal(skills.length, 39);
      const result = api.matchGilSkillAnimationIds(skills, presets);
      assert.equal(result.matched.length, 37);
      assert.deepEqual(result.missing, []); assert.deepEqual(result.ambiguous, []);
      assert.deepEqual(result.presets, presets);
      assert.equal(skills.find(item => item.name === '[演出]玩家传送').id, '1098907690');
      assert.equal(skills.find(item => item.name === '[演出]冲刺-后摇').id, '1098907700');
      assert.deepEqual(api.readGilSkillTable(original), [], 'GIA export entries must not be confused with the GIL definition table');
      if (sources[0]) {
        const imported = api.readGilSkillTable(converter.decode(sources[0].bytes, { type: 'gil' }));
        assert.equal(skills.filter(item => imported.find(candidate => candidate.name === item.name)?.id !== item.id).length, 38);
      }
    });
    await test('Every supplied source archive retains its original bytes', () => {
      sources.forEach((source, index) => assert.equal(hash(fs.readFileSync(source.file)), hashes[index]));
    });
    console.log(`\n${count} GIL skill animation checks passed.`);
  } finally {
    Module._load = originalLoad;
    if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
