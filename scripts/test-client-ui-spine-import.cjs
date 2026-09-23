const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const oldTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f);
async function main() {
  const { convertSpineDocument, importSpineFiles } = require('../src/views/ClientUIAnimationEditor/spineImporter.ts');
  const { buildKeyframeTimelineDataLua } = require('../src/views/ClientUIAnimationEditor/keyframeLua.ts');
  const { evaluateKeyframeTrack } = require('../src/views/ClientUIAnimationEditor/keyframeTimeline.ts');
  const source = { skeleton: { spine: '3.8.75', x: -50, y: 0, width: 100, height: 100 },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 20, y: 30, rotation: 40, length: 60, scaleX: 2 }],
    slots: [{ name: 'back', bone: 'arm', attachment: 'body' }, { name: 'front', bone: 'arm', attachment: 'body' }],
    skins: [{ name: 'default', attachments: { back: { body: { width: 100, height: 100 } }, front: { body: { width: 100, height: 100 } } } }],
    animations: { idle: { bones: { arm: { translate: [{ time: .5, x: 0, curve: 'stepped' }, { time: 1, x: 40 }],
      rotate: [{ angle: 0, curve: .25, c3: .75 }, { time: 1, angle: 20 }], scale: [{}, { time: 1, x: 2, y: 2 }] } } }, run: { bones: { arm: { translate: [{}, { time: 2, x: -20 }] } } } } };
  let reads = 0; const before = JSON.stringify(source);
  const result = await convertSpineDocument(source, 'Demo', 1600, 900, async p => { assert.equal(p, 'body'); reads++; return 'data:image/png;base64,AA=='; });
  assert.equal(JSON.stringify(source), before);
  assert.equal(reads, 1); assert.equal(result.resources.length, 1);
  assert.equal(result.nodes.filter(n => !n.parentId).length, 1);
  assert.deepEqual(result.nodes.filter(n => n.type === 'primitive').map(n => n.name), ['front', 'back']);
  assert.equal(result.nodes.find(n => n.name === 'arm').scaleX, 2);
  assert.equal(result.animations.length, 2);
  assert.ok(result.warnings.some(w => w.includes('缩放动画')));
  assert.ok(result.warnings.some(w => w.includes('30 Hz')));
  const x = result.animations[0].keyframeTracks.find(t => t.fieldKey === 'anchoredPositionX');
  assert.equal(evaluateKeyframeTrack(x, 0, 20), 20);
  assert.equal(evaluateKeyframeTrack(x, .75, 20), 20);
  assert.equal(evaluateKeyframeTrack(x, 1, 20), 60);
  const rotation = result.animations[0].keyframeTracks.find(t => t.fieldKey === 'localRotationZ');
  assert.equal(rotation.keyframes[0].value, 40); assert.equal(rotation.keyframes.at(-1).value, 60);
  assert.ok(Math.abs(evaluateKeyframeTrack(rotation, .5, 40) - 50) < .001);
  assert.ok(result.animations.every(a => a.keyframeTracks.every(t => !t.fieldKey.startsWith('localScale'))));
  const exported = buildKeyframeTimelineDataLua({ projectName: 'Spine', rootNodeId: result.nodes[0].id, nodes: result.nodes, tracks: result.animations[0].keyframeTracks, sequenceDuration: 1 });
  assert.equal(exported.trackCount, 3);
  await assert.rejects(() => convertSpineDocument({ ...source, skeleton: { spine: '4.2' } }, 'x', 100, 100, async () => ''), /3.8/);
  const broken = JSON.parse(before); broken.bones[1].parent = 'missing';
  await assert.rejects(() => convertSpineDocument(broken, 'x', 100, 100, async () => ''), /父骨骼/);
  await assert.rejects(() => importSpineFiles([new File(['binary'], 'a.spine')], 100, 100), /JSON/);
  await assert.rejects(() => importSpineFiles([new File([before], 'skeleton.json')], 100, 100), /图片.*缺失/);
  await assert.rejects(() => importSpineFiles([new File([before], 'a.json'), new File([before], 'b.json')], 100, 100), /多个 JSON/);
  console.log('PASS hierarchy, static scale, slot order, embedded resource reuse, multiple animations, curves, stepped/delayed keys, Lua export and invalid inputs');
  const originalReader = global.FileReader;
  global.FileReader = class {
    readAsDataURL(file) { file.arrayBuffer().then(bytes => { this.result = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }, () => this.onerror()); }
  };
  const folderFile = (content, relativePath) => {
    const file = new File([content], relativePath.split('/').at(-1));
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
    return file;
  };
  try {
    const folderSource = JSON.parse(before); folderSource.skeleton.images = './images/';
    const folder = [folderFile(JSON.stringify(folderSource), 'Demo/skeleton.json'), folderFile('{}', 'Demo/config.json'),
      folderFile('correct', 'Demo/images/body.png'), folderFile('wrong', 'Demo/body.png')];
    const imported = await importSpineFiles(folder, 1600, 900);
    assert.equal(imported.name, 'Demo'); assert.equal(imported.animations.length, 2);
    assert.equal(imported.resources[0].imageUrl, 'data:image/png;base64,' + Buffer.from('correct').toString('base64'));
    const withBinary = await importSpineFiles([...folder, folderFile('ignored', 'Demo/other.spine')], 1600, 900);
    assert.deepEqual(withBinary, imported);
    await assert.rejects(() => importSpineFiles([...folder, folderFile(before, 'Demo/other/skeleton.json')], 100, 100), /多个 JSON/);
    await assert.rejects(() => importSpineFiles([folder[0], folderFile('a', 'Demo/a/body.png'), folderFile('b', 'Demo/b/body.png')], 100, 100), /同名冲突/);
    if (process.argv[2]) {
      const path = require('path'); const directory = path.dirname(process.argv[2]);
      const realFiles = fs.readdirSync(directory).filter(n => /\.(json|png)$/i.test(n)).map(n => folderFile(fs.readFileSync(path.join(directory, n)), `spinetoastra/${n}`));
      const realFolder = await importSpineFiles(realFiles, 1600, 900);
      assert.equal(realFolder.nodes.length, 4); assert.equal(realFolder.animations[0].duration, 1.4);
      assert.ok(realFolder.resources[0].imageUrl.length > 100000);
    }
    console.log('PASS folder import without .spine, JSON selection, subfolder images, path priority, embedded bytes and ambiguous files');
  } finally { global.FileReader = originalReader; }
  if (process.argv[2]) {
    const real = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const converted = await convertSpineDocument(real, 'spinetoastra', 1600, 900, async p => {
      const imagePath = require('path').join(require('path').dirname(process.argv[2]), p + '.png');
      return 'data:image/png;base64,' + fs.readFileSync(imagePath).toString('base64');
    });
    assert.equal(converted.nodes.length, 4); assert.equal(converted.resources.length, 1);
    assert.equal(converted.animations.length, 1); assert.equal(converted.animations[0].duration, 1.4);
    const lanes = converted.animations[0].keyframeTracks;
    assert.equal(lanes.length, 3);
    const r = lanes.find(t => t.fieldKey === 'localRotationZ');
    assert.ok(Math.abs(evaluateKeyframeTrack(r, .7, 84.49) - 105.1) < .001);
    assert.ok(converted.resources[0].imageUrl.length > 100000);
    console.log('PASS real spinetoastra sample: 2 bones + 1 image, 1.4s animation, 3 supported tracks, portable PNG');
  }
  const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
  const filename = 'src/views/ClientUIAnimationEditor/ClientUIAnimationEditor.vue';
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename }); assert.deepEqual(errors, []);
  const script = compileScript(descriptor, { id: 'spine-import-test' });
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: 'spine-import-test', compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  assert.match(descriptor.template.content, /导入 Spine 动画文件夹/);
  assert.match(descriptor.scriptSetup.content, /archive\.createDocument\(imported\.name/);
  console.log('PASS menu/folder input and editor SFC compilation');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { Module._extensions['.ts'] = oldTs; });
