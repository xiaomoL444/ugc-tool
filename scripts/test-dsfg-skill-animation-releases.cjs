/* node scripts/test-dsfg-skill-animation-releases.cjs [1.0.3.1.gil] [1.0.4.gil] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const vue = require('vue');

async function main() {
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, 'src/views/DSFGStudio/components');
  const converter = await import(pathToFileURL(path.join(root, 'vendor/genshin-impact-ugc-file-converter-web/dist/index.js')).href);
  const library = await import('miliastra-variable');
  const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
  let context;
  Module._load = function(request, parent, main) {
    if (request === 'vue') return { ...vue, inject: key => context?.[key], onMounted: fn => context.mount.push(fn), onBeforeUnmount: fn => context.unmount.push(fn) };
    if (request === 'genshin-impact-ugc-file-converter-web') return converter;
    if (request === 'miliastra-variable') return library;
    return originalLoad.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, main);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
  }).outputText, file);
  const scope = vue.effectScope();
  try {
    const { systemPresetConfig } = require(path.join(base, 'EntityPresetEditor/systemPresetConfig.ts'));
    const { useSkillAnimationPresets } = require(path.join(base, 'EntityPresetEditor/useSkillAnimationPresets.ts'));
    const { usePresetReferences } = require(path.join(base, 'EntityPresetEditor/presetReferences.ts'));
    const { workspaceSettingsKey } = require(path.join(base, 'useWorkspaceSettings.ts'));
    const { isSkillAnimationApplicable } = require(path.join(base, 'EntityPresetEditor/skillAnimationPresets.ts'));
    const { readGilSkillTable } = require(path.join(base, 'gilSkillAnimations.ts'));
    const { readWorkspaceGilCalibration } = require(path.join(base, 'workspaceGilCalibration.ts'));
    const all = systemPresetConfig.skillAnimations.presets;
    const added = all.filter(row => row.applicability);
    assert.equal(added.length, 31);
    assert.ok(all.filter(row => !row.applicability).every(row => row.name.endsWith('（v7.1）')));
    assert.ok(added.every(row => row.name.endsWith('（v7.2）')));
    assert.equal(new Set(all.map(row => row.id)).size, all.length);
    assert.equal(new Set(all.map(row => row.configId)).size, all.length);
    for (const fileType of [0, 1, 2]) for (const row of added) {
      assert.equal(isSkillAnimationApplicable(row.id, { fileType, templateReleaseId: 1 }), false);
      assert.equal(isSkillAnimationApplicable(row.id, { fileType, templateReleaseId: 2 }), true);
    }
    const files = new Map(), writes = [];
    const storage = { setProject() { return this; }, async exists(file) { return files.has(file); },
      async readFile(file) { return files.get(file); }, async writeFile(file, raw) { files.set(file, raw); writes.push(file); } };
    const target = vue.ref({ fileType: 0, templateReleaseId: 1 });
    context = { storage, selectedWorkspaceId: vue.ref('release-test'), mount: [], unmount: [], [workspaceSettingsKey]: target };
    let skills, references;
    scope.run(() => { skills = useSkillAnimationPresets(); references = usePresetReferences(); });
    await Promise.all(context.mount.map(fn => fn()));
    assert.equal(skills.presets.value.length, 68, 'All system rows stay in editable/history state even on 7.1');
    assert.equal(skills.visibleSystemPresets.value.length, 37);
    assert.equal(references.options('skillAnimations.configId', 'ConfigReference').length, 37);
    assert.deepEqual(writes, []);

    target.value = { fileType: 2, templateReleaseId: 2 };
    assert.equal(skills.visibleSystemPresets.value.length, 68);
    assert.equal(references.options('skillAnimations.configId', 'ConfigReference').length, 68);
    const row = skills.presets.value.find(row => row.id === added[0].id);
    row.configId = '12345';
    skills.customPresets.value = [{ id: 'user-animation', name: '自定义动画', configId: '45678' }];
    await skills.flush();
    const saved = files.get('/release-test/SkillAnimationPresets.json');
    target.value = { fileType: 1, templateReleaseId: 1 };
    assert.equal(skills.visibleSystemPresets.value.length, 37);
    assert.equal(references.options('skillAnimations.configId', 'ConfigReference').some(item => item.value === '12345'), false);
    assert.ok(references.options('skillAnimations.configId', 'ConfigReference').some(item => item.value === '45678'));
    assert.equal(skills.presets.value.find(item => item.id === row.id).configId, '12345');
    assert.equal(skills.presets.value.length, 69);
    const writeCount = writes.length;
    await skills.flush();
    assert.equal(writes.length, writeCount);
    assert.equal(files.get('/release-test/SkillAnimationPresets.json'), saved);
    const override = JSON.parse(saved).systemOverrides.find(item => item.id === row.id);
    assert.equal(override.configId, '12345');
    assert.equal(override.applicability, undefined, 'Release rules are catalog metadata, not workspace edits');
    skills.systemPresets.value[0].configId = '54321';
    await skills.flush();
    assert.equal(JSON.parse(files.get('/release-test/SkillAnimationPresets.json')).systemOverrides.find(item => item.id === row.id).configId, '12345',
      'Saving an older release must retain the hidden newer-animation override');
    target.value = { fileType: 0, templateReleaseId: 2 };
    assert.equal(skills.visibleSystemPresets.value.find(item => item.id === row.id).configId, '12345');
    assert.ok(references.options('skillAnimations.configId', 'ConfigReference').some(item => item.value === '12345'));
    console.log('PASS All three file types gate the 31 new system animations at release 2; cards and actual reference options react without losing overrides or custom rows');

    const sources = process.argv.slice(2);
    if (sources.length) {
      assert.equal(sources.length, 2, 'Supply both the old and new GIL for comparison');
      const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const before = sources.map(hash);
      const tables = sources.map(file => readGilSkillTable(converter.decode(fs.readFileSync(file), { type: 'gil' })));
      assert.deepEqual(tables.map(table => table.length), [42, 73]);
      const difference = tables[1].filter(row => !tables[0].some(old => old.id === row.id));
      assert.deepEqual(difference.map(row => [row.name.replace(/^\[演出\]/, ''), row.id]).sort(), added.map(row => [row.name.replace(/（v7\.2）$/, ''), row.configId]).sort());
      assert.equal(tables[0].filter(row => !tables[1].some(current => current.id === row.id && current.name === row.name)).length, 0);
      for (let i = 0; i < sources.length; i++) {
        const bytes = fs.readFileSync(sources[i]);
        const calibration = await readWorkspaceGilCalibration({ name: path.basename(sources[i]), size: bytes.length, async arrayBuffer() { return bytes; } }, { fileType: 1, templateReleaseId: i + 1 });
        assert.equal(calibration.result.skills.matched.length, i ? 68 : 37);
        assert.deepEqual(calibration.result.skills.missing, []);
        assert.deepEqual(calibration.result.skills.ambiguous, []);
        assert.ok(calibration.result.skills.presets.every(row => row.applicability === undefined));
      }
      assert.deepEqual(sources.map(hash), before);
      console.log('PASS The real 42→73 GIL comparison exactly matches all 31 added names and IDs; both releases calibrate with no missing animations; source bytes are unchanged');
    }
  } finally {
    context?.unmount.forEach(fn => fn()); scope.stop();
    Module._load = originalLoad;
    if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
