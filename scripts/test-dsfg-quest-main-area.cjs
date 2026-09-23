const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { ref, computed } = require('vue');
const source = fs.readFileSync('src/views/DSFGStudio/components/QuestEditor/QuestMainAreaSelect.vue', 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*;\r?\n/gm, '');
const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
async function main() {
  let scene = { worlds: [{ id: '42', name: '世界' }], mainAreas: [{ id: '123', name: '一级区域', worldId: '42' }] };
  let exists = true;
  let fail = false;
  const emitted = [];
  const storage = { setProject() { return this; }, async exists() { return exists; }, async readFile() { if (fail) throw Error('读取失败'); return JSON.stringify(scene); } };
  const api = new Function('ref', 'computed', 'inject', 'defineProps', 'defineEmits', 'onMounted', 'onBeforeUnmount', 'SCENE_FILE', 'ProjectID', 'decodeSceneProject', 'createSceneProject', code + '\nreturn {load, options, currentExists, hasInvalidAreas, selectMainArea, error};')(
    ref, computed, key => key === 'storage' ? storage : ref('test'), () => ({ modelValue: 123 }), () => (...args) => emitted.push(args), () => {}, () => {}, 'Scene.json', 'test', JSON.parse, () => scene,
  );
  await api.load();
  assert.deepEqual(api.options.value, [{ id: 123, name: '一级区域' }]);
  assert.equal(api.currentExists.value, true);
  api.selectMainArea({ target: { value: '42' } });
  assert.equal(emitted.length, 0);
  api.selectMainArea({ target: { value: '123' } });
  assert.deepEqual(emitted, [['update:modelValue', 123]]);
  scene.mainAreas = [{ id: '5', name: 'A' }, { id: '05', name: 'B' }, { id: 'bad' }, { id: '2147483648' }, { id: '7', name: '' }];
  await api.load();
  assert.deepEqual(api.options.value, [{ id: 7, name: '未命名一级区域' }]);
  assert.equal(api.hasInvalidAreas.value, true);
  assert.equal(api.currentExists.value, false);
  scene.mainAreas = [];
  await api.load();
  assert.deepEqual(api.options.value, []);
  exists = false;
  scene.mainAreas = [{ id: '8', name: '默认区域' }];
  await api.load();
  assert.equal(api.options.value[0].id, 8);
  exists = true; fail = true;
  await api.load();
  assert.equal(api.error.value, '读取失败');
  api.selectMainArea({ target: { value: '8' } });
  assert.equal(emitted.length, 1);
  console.log('PASS primary-area source, selection, invalid/duplicate IDs, unmatched IDs, empty/default scenes and failed reads');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
