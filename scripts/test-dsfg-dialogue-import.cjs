/* Run with: node scripts/test-dsfg-dialogue-import.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

async function main() {
  const library = await import('miliastra-variable');
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, 'src/views/DSFGStudio/components/DialogueEditor');
  const originalLoad = Module._load, originalTs = Module._extensions['.ts'];
  Module._load = function(name, parent, isMain) {
    if (name === 'miliastra-variable') return library;
    return originalLoad.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, isMain);
  };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
  }).outputText, file);
  let passed = 0, failed = 0;
  async function test(name, run) {
    try { await run(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.message.slice(0, 1400)); }
  }
  try {
    const model = require(path.join(base, 'utils/dialogueProject.ts'));
    const codec = require(path.join(base, 'utils/dialogueProjectCodec.ts'));
    const exporter = require(path.join(base, 'utils/qxqyPerformanceExporter.ts')).exportQxqyPerformance;
    const importer = require(path.join(base, 'utils/qxqyPerformanceImporter.ts')).importQxqyPerformance;
    const canonical = value => {
      if (Array.isArray(value)) return value.map(canonical);
      if (!value || typeof value !== 'object') return value;
      if (value.param_type === 'Float') return { ...value, value: String(Number(value.value)) };
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, canonical(child)]));
    };
    function group(project, id = 'group') {
      const node = model.createDialogueNode(id); node.dialogue = undefined;
      project.dialogue.nodes[id] = node;
      project.graph.nodes.push({ id, type: 'group', position: { x: 0, y: 0 }, data: { dialogueNodeId: id } });
      return node;
    }
    function edge(project, source, target, handle = 'next') {
      project.graph.edges.push({ id: crypto.randomUUID(), source, target, sourceHandle: handle, targetHandle: 'input' });
    }
    function scene() {
      const project = model.createEmptyDialogueProject(), node = group(project);
      edge(project, project.dialogue.entryNodeId, node.id, 'output');
      return { project, node };
    }
    function camera(node, position = 'NOLOC_Orbit', viewpoint = 'NOLOC_LookAt', pointType = 'NOLOC_Guid', duration = 1.25) {
      const clip = model.createPerformanceClip('Camera', 0.25);
      clip.duration = duration;
      clip.components[0].cameraViewpointEnabled = true;
      const slot = i => ({ space: i % 2, pointType, vector3: `${i + 1}.25,-2.5,3`, guid: '18446744073709551615',
        entity: '实体查询-' + i, attachmentPoint: 'Head-' + i, offset: '-4.25,5.5,-6', requiresClientPos: i % 2 === 0 });
      clip.components[0].properties = {
        cameraName: 'NOLOC_Test',
        positionData: { type: position, slot: position === 'NOLOC_Linear' ? [slot(0), slot(1)] : [slot(0)],
          snapToTarget: true, orbitRotStart: '-10.5,20,30', orbitRotEnd: '40,50.25,-60', orbitRadius: 7.75 },
        rotationData: { type: viewpoint, slot: viewpoint === 'NOLOC_Linear' ? [slot(2), slot(3)] : [slot(2)], snapToTarget: true },
      };
      node.lines[0].clips.push(clip);
      return clip;
    }
    function roundtrip(project) {
      const output = exporter(project), imported = importer('\uFEFF' + output.json).project;
      assert.deepEqual(canonical(exporter(imported).value), canonical(output.value), 'Import must preserve runtime values');
      const reopened = codec.decodeDialogueProject(codec.encodeDialogueProject(imported));
      assert.deepEqual(canonical(exporter(reopened).value), canonical(output.value), 'Saving and reopening must preserve runtime values');
      return { imported, reopened, output };
    }
    for (const position of ['NOLOC_Fixed', 'NOLOC_Linear', 'NOLOC_Follow', 'NOLOC_Orbit']) {
      for (const viewpoint of ['NOLOC_Fixed', 'NOLOC_Linear', 'NOLOC_LookAt']) {
        await test(`Camera ${position}/${viewpoint}: every slot field and enabled viewpoint survives import and reopen`, () => {
          const { project, node } = scene();
          for (const pointType of ['NOLOC_Vector3', 'NOLOC_Rot', 'NOLOC_Guid', 'NOLOC_Entity']) camera(node, position, viewpoint, pointType);
          const { imported, reopened } = roundtrip(project);
          for (const restored of [imported, reopened]) {
            for (const clip of Object.values(restored.dialogue.nodes)[0].lines.flatMap(line => line.clips)) {
              const component = clip.components[0];
              assert.equal(component.cameraViewpointEnabled, true);
              assert.equal(component.properties.positionData.orbitRadius, 7.75, 'Orbit radius must display as an editor number');
              assert.equal(typeof component.properties.rotationData.slot[0].space, 'number');
              assert.equal(component.properties.rotationData.slot[0].guid, '18446744073709551615');
            }
          }
        });
      }
    }
    await test('Unconfigured viewpoint stays disabled without adding runtime slots; active empty slots remain empty', () => {
      const { project, node } = scene();
      const blank = camera(node); blank.components[0].cameraViewpointEnabled = false;
      const empty = camera(node); empty.components[0].properties.rotationData.slot = [];
      empty.components[0].properties.positionData.slot = [];
      const { reopened } = roundtrip(project);
      const clips = Object.values(reopened.dialogue.nodes)[0].lines.flatMap(line => line.clips);
      assert.equal(clips[0].components[0].cameraViewpointEnabled, false);
      assert.equal(clips[1].components[0].cameraViewpointEnabled, true);
      assert.deepEqual(clips[1].components[0].properties.rotationData.slot, []);
      assert.deepEqual(clips[1].components[0].properties.positionData.slot, []);
    });
    await test('Zero and short camera durations retain their original timing after reopen', () => {
      const { project, node } = scene();
      for (const duration of [0, 0.01, 0.09, 0.1, 1.25]) camera(node, 'NOLOC_Linear', 'NOLOC_Linear', 'NOLOC_Guid', duration);
      roundtrip(project);
    });
    await test('Dialogue/select fields, empty text and styles, all public parameter types and nested IDs roundtrip', () => {
      for (const style of ['NOLOC_Default', 'NOLOC_BottomDialog', 'NOLOC_BlackScreen', '自定义样式', '']) {
        const { project, node } = scene();
        project.exportSettings.qxqyStructIds = Object.fromEntries(Object.keys(project.exportSettings.qxqyStructIds).map((key, i) => [key, String(97000 + i)]));
        node.dialogue = { ...model.createDialogueClip(), style, speaker: '说话人', subtitle: '副标题', content: '',
          startTime: 0.25, continueDelayTime: 0, autoContinue: 2.75, nodeGraphEvent: ['0', '-2147483648', '2147483647'] };
        node.select = { ...model.createSelectClip(), style: '', startTime: 0.5, continueDelayTime: 1.5,
          options: [{ ...model.createSelectOption(), content: '', icon: -1 }, { ...model.createSelectOption(), content: '选项', icon: 100 }],
          params: ['-2147483648', '0', '2147483647'] };
        camera(node);
        const line = model.createPerformanceLine('PublicEvent'), clip = model.createPerformanceClip('PublicEvent', 0.75);
        clip.duration = 0;
        clip.components[0].properties.value = '';
        clip.components[0].properties.parameters = ['String', 'String', 'Int32', 'Int32', 'Guid', 'ConfigReference', 'EntityReference', 'Float', 'Float'].map((type, i) => ({
          id: String(i), name: type, type, value: ['', '文本\n第二行', '-2147483648', '2147483647', '18446744073709551615', '12345', '54321', '-1.25', '0'][i],
        }));
        line.clips.push(clip); node.lines.push(line);
        const custom = model.createPerformanceLine('Custom'), trigger = model.createPerformanceClip('Custom', 1);
        trigger.components[0].properties.value = ' '; custom.clips.push(trigger); node.lines.push(custom);
        const { reopened } = roundtrip(project);
        assert.deepEqual(reopened.exportSettings.qxqyStructIds, project.exportSettings.qxqyStructIds);
        const restored = Object.values(reopened.dialogue.nodes)[0];
        assert.equal(restored.dialogue.style, style);
        assert.equal(restored.select.style, '');
        assert.equal(restored.dialogue.autoContinue, 2.75);
      }
    });
    await test('Shared and independent forced advance, duplicate targets, empty exits, loops and branches keep their slots', () => {
      for (const outputMode of ['Self', 'Shared']) {
        const { project, node } = scene();
        node.select = model.createSelectClip(); node.select.options.push(model.createSelectOption(), model.createSelectOption());
        node.focusPush = { ...model.createFocusPushClip(1), outputMode, sharedOutletIndex: 1 };
        const target = group(project, 'target'); target.dialogue = { ...model.createDialogueClip(), advanceMode: 'None', autoContinue: -1 };
        const branch = model.createConditionBranchNode('branch');
        branch.outputs[0].condition = '{1:ps.Test} < -1 && {1:ps.Flag} == true'; branch.outputs[1].condition = '';
        project.dialogue.conditionBranches.branch = branch;
        project.graph.nodes.push({ id: 'branch', type: 'condition', position: { x: 1, y: 2 }, data: { conditionBranchNodeId: 'branch' } });
        edge(project, node.id, target.id, 'select:' + node.select.options[0].id);
        edge(project, node.id, target.id, 'select:' + node.select.options[2].id);
        if (outputMode === 'Self') edge(project, node.id, 'branch', 'focus-push');
        edge(project, target.id, 'branch'); edge(project, 'branch', node.id, branch.outputs[0].id);
        roundtrip(project);
      }
    });
    await test('More than 100 groups, actions at one time and camera table rows survive bucket boundaries', () => {
      const project = model.createEmptyDialogueProject();
      let previous = project.dialogue.entryNodeId;
      for (let i = 0; i < 102; i++) {
        const node = group(project, 'group-' + i); node.dialogue = model.createDialogueClip();
        edge(project, previous, node.id, i ? 'next' : 'output'); previous = node.id;
        camera(node);
        if (!i) for (let j = 0; j < 101; j++) camera(node);
      }
      roundtrip(project);
    });
    await test('Unknown actions and bad schemas fail before any imported document is returned', () => {
      const { project, node } = scene(); camera(node);
      const value = exporter(project).value;
      function change(item) {
        if (Array.isArray(item)) return item.forEach(change);
        if (!item || typeof item !== 'object') return;
        if (item.param_type === 'String' && item.value === 'NOLOC_CAMERA') item.value = 'NOLOC_UNSUPPORTED';
        else Object.values(item).forEach(change);
      }
      change(value);
      assert.throws(() => importer(JSON.stringify(value)), /不支持/);
      assert.throws(() => importer('{}'), /结构体/);
    });
    console.log(`${passed} dialogue import checks passed; ${failed} failed.`);
    if (failed) process.exitCode = 1;
  } finally {
    Module._load = originalLoad;
    if (originalTs) Module._extensions['.ts'] = originalTs; else delete Module._extensions['.ts'];
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
