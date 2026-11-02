/* Run with: node scripts/test-dsfg-workspace-settings.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const base = path.resolve(__dirname, '../src/views/DSFGStudio/components');
const previousTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
}).outputText, file);

async function main() {
  const releases = require(path.join(base, 'versioning/baseReleases.ts'));
  const settingsApi = require(path.join(base, 'workspaceSettings.ts'));
  const contextApi = require(path.join(base, 'useWorkspaceSettings.ts'));
  const features = require(path.join(base, 'workspaceFeatures.ts'));
  let count = 0;
  async function test(name, check) { await check(); count++; console.log(`PASS ${name}`); }
  const memory = () => {
    const files = new Map(), writes = [];
    return { files, writes, async exists(p) { return files.has(p); }, async readFile(p) { return files.get(p); },
      async writeFile(p, value) { files.set(p, value); writes.push(p); } };
  };

  await test('Integer file type zero survives save/reload; missing legacy settings use map / 7.1 without writes', async () => {
    const storage = memory();
    assert.deepEqual(await settingsApi.loadWorkspaceSettings(storage, 'old'), settingsApi.createWorkspaceSettings());
    assert.deepEqual(storage.writes, []);
    assert.equal(settingsApi.createWorkspaceSettings().fileType, 0);
    assert.equal(settingsApi.createWorkspaceSettings().baseReleaseId, 1);
    assert.deepEqual(settingsApi.createWorkspaceSettings().packageIds, []);
    assert.equal(releases.latestBaseReleaseId, 2);
    for (const fileType of [0, 1, 2]) {
      const target = settingsApi.createWorkspaceSettings({ fileType, baseReleaseId: 2, packageIds: [] });
      await storage.writeFile('/new/WorkspaceSettings.json', settingsApi.encodeWorkspaceSettings(target));
      assert.deepEqual(await settingsApi.loadWorkspaceSettings(storage, 'new'), target);
    }
  });
  await test('Corrupt settings, unknown IDs and string IDs are rejected without rewriting original bytes', async () => {
    for (const raw of ['{bad', '{}', ...[{ fileType: 3 }, { fileType: '0' }, { schemaVersion: 4 },
      { baseReleaseId: 99 }, { packageIds: [99] }, { packageIds: null }, { baseReleaseId: undefined }]
      .map(value => JSON.stringify({ ...settingsApi.createWorkspaceSettings(), ...value }))]) {
      const storage = memory(); storage.files.set('/a/WorkspaceSettings.json', raw);
      await assert.rejects(settingsApi.loadWorkspaceSettings(storage, 'a'));
      assert.equal(storage.files.get('/a/WorkspaceSettings.json'), raw); assert.deepEqual(storage.writes, []);
    }
  });
  await test('Create/rename name validation rejects paths and duplicate names while accepting the current name', () => {
    for (const name of ['', ' ', '.', '..', '../other', 'a/b', 'a\\b', 'CON', 'NUL.txt', 'trailing.']) {
      assert.ok(settingsApi.workspaceNameError(name, []), name);
    }
    assert.ok(settingsApi.workspaceNameError('existing', ['Existing']));
    assert.equal(settingsApi.workspaceNameError('Existing', ['Existing'], 'Existing'), '');
    assert.equal(settingsApi.workspaceNameError(' 新工作区 ', ['Existing']), '');
  });
  await test('Shared target reflects workspace changes and stays isolated between studio instances', () => {
    const current = vue.ref(settingsApi.createWorkspaceSettings());
    const app = vue.createApp({}); app.provide(contextApi.workspaceSettingsKey, current);
    const firstReader = app.runWithContext(contextApi.useWorkspaceSettings);
    const secondReader = app.runWithContext(contextApi.useWorkspaceSettings);
    const otherApp = vue.createApp({});
    otherApp.provide(contextApi.workspaceSettingsKey, vue.ref(settingsApi.createWorkspaceSettings()));
    const otherReader = otherApp.runWithContext(contextApi.useWorkspaceSettings);
    current.value = settingsApi.createWorkspaceSettings({ fileType: 2, baseReleaseId: 2, packageIds: [] });
    assert.equal(firstReader.value.fileType, 2); assert.equal(secondReader.value.baseReleaseId, 2);
    assert.equal(otherReader.value.fileType, 0); assert.equal(otherReader.value.baseReleaseId, 1);
  });
  await test('File-type restrictions and inclusive/exclusive version ranges use shared workspace targets', () => {
    for (const fileType of [0, 1, 2]) for (const baseReleaseId of [1, 2]) {
      const target = { fileType, baseReleaseId, packageIds: [] };
      for (const key of ['Quest', 'Scene', 'questStyles', 'multilingualTexts', 'saveModules']) assert.equal(features.isWorkspaceFeatureAvailable(key, target), fileType === 0);
      for (const key of ['Dialogue', 'Camera', 'EntityPresets', 'dialogueStyles']) assert.equal(features.isWorkspaceFeatureAvailable(key, target), true);
      assert.equal(features.isWorkspaceStructGroupAvailable('任务', target), fileType === 0);
      assert.equal(features.isWorkspaceStructGroupAvailable('场景', target), fileType === 0);
      assert.equal(features.isWorkspaceStructGroupAvailable('演出对话', target), true);
      assert.equal(features.isApplicable({ fileTypes: [0, 1], baseVersionRanges: [{ min: { releaseId: 1, inclusive: false } }] }, target), fileType !== 2 && baseReleaseId === 2);
      assert.equal(features.isApplicable({ baseVersionRanges: [{ max: { releaseId: 2, inclusive: false } }] }, target), baseReleaseId === 1);
      assert.equal(features.isApplicable({ baseVersionRanges: [{ min: { releaseId: 1, inclusive: true }, max: { releaseId: 1, inclusive: true } }, { min: { releaseId: 2, inclusive: true } }] }, target), true);
    }
  });
  await test('Workspace creation and combined settings templates compile with the existing editor shell', () => {
    for (const relative of ['../DSFGStudio.vue', 'WorkspaceStructIdSettings.vue', 'WorkspaceVersionSettings.vue', 'WorkspaceGilCalibration.vue', 'StudioCreateDialog.vue']) {
      const filename = path.join(base, relative), descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor;
      const script = compileScript(descriptor, { id: 'workspace-settings-test' });
      assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'workspace-settings-test', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
    }
  });
  console.log(`\n${count} workspace settings checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (previousTs) Module._extensions['.ts'] = previousTs; else delete Module._extensions['.ts'];
});
