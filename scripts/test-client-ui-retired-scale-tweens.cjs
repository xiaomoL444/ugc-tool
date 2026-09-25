const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const oldTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, f);
try {
  const registry = require('../src/views/ClientUIAnimationEditor/tweenRegistry.ts');
  const { controlRegistry, createControlProperties } = require('../src/views/ClientUIAnimationEditor/controlRegistry.ts');
  const { removeRetiredScaleTweenTracks } = require('../src/views/ClientUIAnimationEditor/timelineCompatibility.ts');
  const { buildKeyframeTimelineDataLua, prepareKeyframeTimelineImport } = require('../src/views/ClientUIAnimationEditor/keyframeLua.ts');
  const { buildTweenTimelineDataLua } = require('../src/views/ClientUIAnimationEditor/luaTweenExporter.ts');
  const node = { id:'root', parentId:null, name:'Root', type:'container', scaleX:2, scaleY:3, scaleZ:1, properties:createControlProperties('container') };
  const fields = ['localScaleX', 'localScaleY', 'localScaleZ'];
  for (const type of Object.keys(controlRegistry)) for (const field of fields) {
    assert.ok(registry.getTweenableField(type, field));
    assert.ok(registry.isScaleTweenField(field));
    assert.ok(registry.isRelativeTweenField(field));
  }
  const tracks = fields.map(fieldKey => ({ id:fieldKey, nodeId:'root', fieldKey, keyframes:[{ id:fieldKey+'-key', time:0, value:1, easeType:'Linear', interpolation:'tween' }] }));
  const project = { nodes:[node], keyframeTracks:tracks, tweenTracks:tracks, animations:[{ keyframeTracks:tracks }] };
  const before = JSON.stringify(project);
  assert.equal(removeRetiredScaleTweenTracks(project), 0);
  assert.equal(JSON.stringify(project), before);
  const options = { projectName:'Test', rootNodeId:'root', nodes:[node], sequenceDuration:5 };
  const exported = buildKeyframeTimelineDataLua({ ...options, tracks });
  assert.equal(exported.trackCount, 3);
  const imported = prepareKeyframeTimelineImport({ source:exported.code, rootNodeId:'root', nodes:[node], existingTracks:[], mode:'append', sequenceDuration:5 });
  assert.deepEqual(imported.errors, []);
  for (const fieldKey of fields) {
    assert.ok(exported.code.includes(fieldKey));
    const clips = buildTweenTimelineDataLua({ ...options, tracks:[{ id:fieldKey, nodeId:'root', fieldKey, startTime:0, duration:1, initialValue:1, endValue:2, easeType:'Linear' }] });
    assert.equal(clips.trackCount, 1);
  }
  const editor = fs.readFileSync('src/views/ClientUIAnimationEditor/ClientUIAnimationEditor.vue', 'utf8');
  assert.ok(editor.includes('field.fieldKey !== "localScaleZ" && !used.has(field.fieldKey)'));
  assert.ok(!editor.includes('removeRetiredScaleTweenTracks'));
  console.log('PASS XYZ support, non-destructive loading, keyframe/clip Lua roundtrip and picker-only hiding');
} finally { Module._extensions['.ts'] = oldTs; }
