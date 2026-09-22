const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const oldTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, file);
try {
  const registry = require('../src/views/ClientUIAnimationEditor/tweenRegistry.ts');
  const { controlRegistry, createControlProperties } = require('../src/views/ClientUIAnimationEditor/controlRegistry.ts');
  const { removeRetiredScaleTweenTracks } = require('../src/views/ClientUIAnimationEditor/timelineCompatibility.ts');
  const { normalizeAnimationCollection } = require('../src/views/ClientUIAnimationEditor/animationCollection.ts');
  const { normalizeKeyframeTracks } = require('../src/views/ClientUIAnimationEditor/keyframeTimeline.ts');
  const { buildKeyframeTimelineDataLua, prepareKeyframeTimelineImport } = require('../src/views/ClientUIAnimationEditor/keyframeLua.ts');
  const { buildTweenTimelineDataLua } = require('../src/views/ClientUIAnimationEditor/luaTweenExporter.ts');
  const node = { id: 'root', parentId: null, name: 'Root', type: 'container', scaleX: 2, scaleY: 3, scaleZ: 1, properties: createControlProperties('container') };
  const lane = (fieldKey) => ({ id: fieldKey, nodeId: node.id, fieldKey,
    keyframes: [{ id: fieldKey + '-key', time: 0, value: 1, easeType: 'Linear', interpolation: 'tween' }] });
  for (const type of Object.keys(controlRegistry)) {
    for (const field of ['localScaleX', 'localScaleY']) {
      assert.equal(registry.getTweenableField(type, field), null);
      assert.equal(registry.isScaleTweenField(field), false);
      assert.equal(registry.isRelativeTweenField(field), false);
    }
    assert.ok(registry.getTweenableField(type, 'localScaleZ'));
    assert.ok(registry.getTweenableField(type, 'sizeDeltaX'));
  }
  console.log('PASS all control pickers exclude scale X/Y; scale Z and size remain supported');
  const lanes = ['localScaleX', 'localScaleY', 'localScaleZ', 'sizeDeltaX'].map(lane);
  const saved = { nodes: [node], tweenTracks: lanes, keyframeTracks: lanes,
    animations: [{ id: 'a', name: 'Idle', duration: 5, keyframeTracks: lanes },
      { id: 'b', name: 'Run', duration: 5, keyframeTracks: [lane('localScaleY')] }] };
  const source = JSON.stringify(saved), parsed = JSON.parse(source);
  assert.equal(removeRetiredScaleTweenTracks(parsed), 7);
  assert.equal(removeRetiredScaleTweenTracks(parsed), 0, 'migration is idempotent');
  assert.deepEqual(parsed.nodes, saved.nodes, 'static node scales unchanged');
  assert.equal(JSON.stringify(saved), source, 'original source is untouched');
  assert.deepEqual(parsed.keyframeTracks.map(t => t.fieldKey), ['localScaleZ', 'sizeDeltaX']);
  assert.equal(normalizeAnimationCollection(parsed.animations, parsed.nodes).length, 2);
  assert.equal(parsed.animations[1].keyframeTracks.length, 0, 'animation survives even with no remaining tracks');
  const malformed = { keyframeTracks: null, animations: [null, { keyframeTracks: 'bad' }] };
  assert.equal(removeRetiredScaleTweenTracks(malformed), 0);
  assert.throws(() => normalizeKeyframeTracks([lane('unknownField')], [node]), /不支持/);
  console.log('PASS legacy clips, keyframes and all animations migrate without changing static scales');
  for (const field of ['localScaleX', 'localScaleY']) {
    assert.throws(() => buildKeyframeTimelineDataLua({ projectName: 'Test', rootNodeId: node.id, nodes: [node], tracks: [lane(field)], sequenceDuration: 5 }), /不支持/);
    const imported = prepareKeyframeTimelineImport({ source: `return {schema="ClientUIAnimationEditor.TweenTimeline@8", duration=5, tracks={{"", "${field}", {{0,1,false,"Linear","tween"}}}}}`,
      rootNodeId: node.id, nodes: [node], existingTracks: [], mode: 'append', sequenceDuration: 5 });
    assert.ok(imported.errors.some(error => error.includes(field)));
    const exported = buildTweenTimelineDataLua({ projectName: 'Test', rootNodeId: node.id, nodes: [node], sequenceDuration: 5,
      tracks: [{ id: field, nodeId: node.id, fieldKey: field, startTime: 0, duration: 1, initialValue: 1, endValue: 2, easeType: 'Linear' }] });
    assert.equal(exported.trackCount, 0);
    assert.ok(exported.warnings.some(warning => warning.includes(field)));
    assert.equal(exported.code.includes(`"${field}"`), false);
  }
  const exported = buildKeyframeTimelineDataLua({ projectName: 'Test', rootNodeId: node.id, nodes: [node], tracks: parsed.keyframeTracks, sequenceDuration: 5 });
  assert.equal(exported.trackCount, 2);
  assert.ok(exported.code.includes('localScaleZ'));
  console.log('PASS invalid Lua Data cannot reintroduce scale X/Y; migrated tracks export normally');
} finally { Module._extensions['.ts'] = oldTs; }
