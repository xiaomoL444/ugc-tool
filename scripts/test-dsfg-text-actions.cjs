/* Run with: node scripts/test-dsfg-text-actions.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

async function main() {
  const library = await import('miliastra-variable');
  const root = path.resolve(__dirname, '..');
  const base = path.join(root, 'src/views/DSFGStudio/components/DialogueEditor/utils');
  const previousLoad = Module._load;
  const previousTs = Module._extensions['.ts'];
  Module._load = function (request, parent, isMain) {
    if (request === 'miliastra-variable') return library;
    return previousLoad.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, isMain);
  };
  Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  try {
    const { applyDialogueTextAction: act } = require(path.join(base, 'dialogueTextActions.ts'));
    const { createEmptyDialogueProject: empty, createConditionBranchNode, createPerformanceClip } = require(path.join(base, 'dialogueProject.ts'));
    const { buildDialogueTextPreview: preview } = require(path.join(base, 'dialogueTextPreview.ts'));
    const { encodeDialogueProject: encode, decodeDialogueProject: decode } = require(path.join(base, 'dialogueProjectCodec.ts'));
    const { captureDialogueDeletion: captureDeletion, canUndoDialogueDeletion: canUndoDeletion } = require(path.join(base, 'dialogueDeletionUndo.ts'));
    const clone = (value) => JSON.parse(JSON.stringify(value));
    let count = 0;
    const test = (name, check) => { check(); count++; console.log(`PASS ${name}`); };
    function sequence() {
      const a = act(empty(), { type: 'create' });
      const b = act(a.project, { type: 'insert', nodeId: a.nodeId });
      const c = act(b.project, { type: 'insert', nodeId: b.nodeId });
      return { project: c.project, ids: [a.nodeId, b.nodeId, c.nodeId] };
    }
    const lineIds = (project) => preview(project).blocks.filter((block) => block.lines.length).map((block) => block.lines.map((line) => line.nodeId));
    test('Create starts an empty document; subsequent groups are detached and survive serialization', () => {
      const original = empty(); const before = clone(original);
      const a = act(original, { type: 'create' });
      assert.deepEqual(original, before);
      assert.ok(preview(a.project).blocks.find((block) => block.lines.length).reachable);
      const b = act(a.project, { type: 'create' });
      assert.equal(preview(b.project).blocks.filter((block) => !block.reachable).length, 1);
      assert.deepEqual(lineIds(decode(encode(b.project))), lineIds(b.project));
    });
    test('Insertion splices a sentence into the existing sequence and preserves all old Clips', () => {
      const { project, ids } = sequence(); const before = clone(project.dialogue.nodes);
      const added = act(project, { type: 'insert', nodeId: ids[0] });
      assert.deepEqual(lineIds(added.project), [[ids[0], added.nodeId, ids[1], ids[2]]]);
      ids.forEach((id) => assert.deepEqual(added.project.dialogue.nodes[id], before[id]));
    });
    test('Reorder preserves dialogue Clip settings, aliases and hidden canvas state', () => {
      const { project, ids } = sequence();
      project.dialogue.nodes[ids[1]].dialogue.startTime = 1.5;
      project.dialogue.nodes[ids[0]].lines[0].clips.push(createPerformanceClip('Camera'));
      project.dialogue.nodes[ids[0]].dialogue.style = 'Black_Screen';
      const canvas = project.graph.nodes.find((node) => node.id === ids[0]);
      canvas.id = 'alias-A'; canvas.hidden = true;
      project.graph.edges.forEach((edge) => { if (edge.source === ids[0]) edge.source = 'alias-A'; if (edge.target === ids[0]) edge.target = 'alias-A'; });
      const before = clone(project);
      const moved = act(project, { type: 'move', nodeId: ids[0], targetId: ids[2] });
      assert.deepEqual(lineIds(moved.project), [[ids[1], ids[2], ids[0]]]);
      const restored = decode(encode(moved.project));
      assert.deepEqual(lineIds(restored), [[ids[1], ids[2], ids[0]]]);
      const movedLine = preview(restored).blocks.find(block => block.kind === 'dialogue').lines[2];
      assert.equal(movedLine.clipCount, 1);
      assert.equal(movedLine.style, 'Black_Screen');
      assert.deepEqual(moved.project.dialogue.nodes, before.dialogue.nodes);
      assert.deepEqual(moved.project.graph.nodes, before.graph.nodes);
      assert.deepEqual(clone(project), before);
    });
    const append = (project, id, kind, outletId = 'next') => act(project, { type: 'append', blockId: preview(project).blocks.find(block => block.nodeIds.includes(id)).id, outletId, kind });
    test('Option icons default to 100160, edit only the selected option and survive text projection and serialization', () => {
      const { applyDialogueOptionIconEdit } = require(path.join(base, 'dialogueTextEditing.ts'));
      const { project, ids } = sequence();
      const selection = append(project, ids[0], 'select');
      const options = selection.project.dialogue.nodes[selection.nodeId].select.options;
      assert.ok(options.every(option => option.icon === 100160));
      assert.equal(applyDialogueOptionIconEdit(selection.project, selection.nodeId, options[0].id, 100001), true);
      assert.equal(options[1].icon, 100160);
      for (const invalid of [-1, 1.5, NaN, Infinity, 2147483648]) assert.equal(applyDialogueOptionIconEdit(selection.project, selection.nodeId, options[0].id, invalid), false);
      assert.equal(applyDialogueOptionIconEdit(selection.project, selection.nodeId, 'missing', 100160), false);
      assert.equal(applyDialogueOptionIconEdit(selection.project, 'missing', options[0].id, 100160), false);
      const restored = decode(encode(selection.project));
      const block = preview(restored).blocks.find(block => block.nodeIds.includes(selection.nodeId));
      assert.deepEqual(block.outlets.map(outlet => outlet.icon), [100001, 100160]);
      options[0].icon = 0;
      delete options[1].icon;
      assert.deepEqual(decode(encode(selection.project)).dialogue.nodes[selection.nodeId].select.options.map(option => option.icon), [0, 100160]);
    });
    test('Deleting the first, middle or final sentence removes its Group and reconnects the sequence', () => {
      for (const index of [0, 1, 2]) {
        const { project, ids } = sequence();
        const before = structuredClone(project);
        const result = act(project, { type: 'delete', nodeId: ids[index] });
        assert.deepEqual(lineIds(result.project), [ids.filter((_, i) => i !== index)]);
        assert.equal(result.project.dialogue.nodes[ids[index]], undefined);
        assert.ok(result.project.graph.nodes.every(node => node.id !== ids[index]));
        assert.ok(result.project.graph.edges.every(edge => edge.source !== ids[index] && edge.target !== ids[index]));
        assert.ok(preview(result.project).blocks.every(block => block.reachable));
        assert.deepEqual(project, before);
      }
      const single = act(empty(), { type: 'create' });
      const result = act(single.project, { type: 'delete', nodeId: single.nodeId });
      assert.deepEqual(lineIds(result.project), []);
      assert.equal(result.project.graph.nodes[0].type, 'entry');
      assert.equal(result.project.graph.edges.length, 0);
      assert.equal(act(result.project, { type: 'delete', nodeId: single.nodeId }), undefined);
    });
    test('Deleting a shared branch target preserves each incoming option and its handle', () => {
      const { project, ids } = sequence();
      const selection = append(project, ids[0], 'select');
      const options = selection.project.dialogue.nodes[selection.nodeId].select.options;
      selection.project.graph.edges = selection.project.graph.edges.filter(edge => edge.source !== ids[2]);
      selection.project.graph.edges.push(...options.map((option, i) => ({ id: `branch-${i}`, source: selection.nodeId, sourceHandle: `select:${option.id}`, target: ids[1], targetHandle: 'input' })));
      const result = act(selection.project, { type: 'delete', nodeId: ids[1] });
      for (const option of options) assert.ok(result.project.graph.edges.some(edge => edge.source === selection.nodeId && edge.sourceHandle === `select:${option.id}` && edge.target === ids[2]));
    });
    test('Deletion resolves graph aliases, retains return loops and avoids dangling self-links', () => {
      const { project, ids } = sequence();
      const canvas = project.graph.nodes.find(node => node.id === ids[1]);
      canvas.id = 'alias-delete';
      project.graph.edges.forEach(edge => { if (edge.target === ids[1]) edge.target = canvas.id; if (edge.source === ids[1]) edge.source = canvas.id; });
      project.graph.edges.push({ id: 'return', source: ids[2], target: canvas.id, sourceHandle: 'next' });
      const result = act(project, { type: 'delete', nodeId: ids[1] });
      assert.ok(result.project.graph.edges.some(edge => edge.source === ids[2] && edge.target === ids[2]));
      assert.ok(result.project.graph.edges.every(edge => edge.source !== 'alias-delete' && edge.target !== 'alias-delete'));
      const only = act(empty(), { type: 'create' });
      only.project.graph.edges.push({ id: 'self', source: only.nodeId, target: only.nodeId, sourceHandle: 'next' });
      assert.equal(act(only.project, { type: 'delete', nodeId: only.nodeId }).project.graph.edges.length, 0);
    });
    test('Deleting text in a mixed choice node retains its options, performance Clips and option connections', () => {
      const { project, ids } = sequence();
      const choice = append(project, ids[0], 'select');
      const mixed = act(choice.project, { type: 'add-dialogue', nodeId: choice.nodeId }).project;
      mixed.dialogue.nodes[choice.nodeId].lines[0].clips.push(createPerformanceClip('Camera'));
      const before = structuredClone(mixed);
      const result = act(mixed, { type: 'delete', nodeId: choice.nodeId });
      assert.equal(result.project.dialogue.nodes[choice.nodeId].dialogue, undefined);
      assert.deepEqual(result.project.dialogue.nodes[choice.nodeId].select, before.dialogue.nodes[choice.nodeId].select);
      assert.deepEqual(result.project.dialogue.nodes[choice.nodeId].lines, before.dialogue.nodes[choice.nodeId].lines);
      assert.deepEqual(result.project.graph, before.graph);
      assert.equal(act(result.project, { type: 'delete', nodeId: choice.nodeId }), undefined);
    });
    test('Undo restores the removed Clip and connections; later edits invalidate the snapshot', () => {
      const { project, ids } = sequence();
      project.dialogue.nodes[ids[1]].lines[0].clips.push(createPerformanceClip('Camera'));
      const result = act(project, { type: 'delete', nodeId: ids[1] });
      const snapshot = captureDeletion(project, result.project, ids[1]);
      assert.equal(canUndoDeletion(snapshot, result.project), true);
      assert.equal(encode(snapshot.project), encode(project));
      assert.deepEqual(lineIds(decode(encode(snapshot.project))), [ids]);
      result.project.dialogue.nodes[ids[0]].dialogue.content = 'later edit';
      assert.equal(canUndoDeletion(snapshot, result.project), false);
      assert.notEqual(snapshot.project.dialogue.nodes[ids[0]].dialogue.content, 'later edit');
    });
    test('Person presets create independent blank dialogue with Default_UI and preserve the selected continuation', () => {
      const { project, ids } = sequence();
      const branch = append(project, ids[0], 'select');
      const block = preview(branch.project).blocks.find(block => block.kind === 'select');
      for (const [source, target, outletId] of [[project, preview(project).blocks.find(block => block.kind === 'dialogue'), 'next'], [branch.project, block, block.outlets[1].id]]) {
        const before = structuredClone(source);
        const preset = { talker: 'A', subtitle: '' };
        const result = act(source, { type: 'append', blockId: target.id, outletId, kind: 'dialogue', preset });
        const clip = result.project.dialogue.nodes[result.nodeId].dialogue;
        assert.equal(clip.speaker, 'A'); assert.equal(clip.subtitle, '');
        assert.equal(clip.content, ''); assert.equal(clip.style, 'Default_UI');
        assert.ok(result.project.graph.edges.some(edge => edge.source === target.nodeIds.at(-1) && edge.sourceHandle === outletId && edge.target === result.nodeId));
        preset.talker = 'B'; preset.subtitle = 'changed';
        assert.equal(clip.speaker, 'A'); assert.equal(clip.subtitle, '');
        assert.deepEqual(source, before);
        assert.deepEqual(decode(encode(result.project)).dialogue.nodes[result.nodeId].dialogue, clip);
      }
      const target = preview(project).blocks.find(block => block.kind === 'dialogue');
      const result = act(project, { type: 'append', blockId: target.id, outletId: 'next', kind: 'dialogue', preset: { talker: 'A', subtitle: '旅行者' } });
      assert.equal(result.project.dialogue.nodes[result.nodeId].dialogue.subtitle, '旅行者');
      assert.deepEqual(lineIds(result.project), [[...ids, result.nodeId]]);
      assert.equal(act(project, { type: 'append', blockId: target.id, outletId: 'next', kind: 'dialogue', preset: { talker: ' ', subtitle: '' } }), undefined);
    });
    test('Adding an option card creates a standalone node without converting dialogue or inventing children', () => {
      const { project, ids } = sequence();
      const before = clone(project.dialogue.nodes);
      const result = append(project, ids[0], 'select');
      const blocks = preview(result.project).blocks;
      const branch = blocks.find((block) => block.kind === 'select');
      assert.deepEqual(branch.nodeIds, [result.nodeId]);
      assert.equal(branch.outlets.length, 2);
      assert.ok(branch.outlets.every((outlet) => !outlet.connected));
      assert.ok(blocks.every((block) => block.reachable && !block.warnings.length));
      ids.forEach(id => assert.deepEqual(result.project.dialogue.nodes[id], before[id]));
      assert.equal(result.project.dialogue.nodes[result.nodeId].dialogue, undefined);
      assert.deepEqual(lineIds(result.project), [ids, [result.nodeId]]);
      const extra = act(result.project, { type: 'add-option', nodeId: result.nodeId });
      assert.equal(preview(extra.project).blocks.find((block) => block.kind === 'select').outlets.length, 3);
      assert.equal(Object.keys(extra.project.dialogue.nodes).length, ids.length + 1);
      const outletId = branch.outlets[1].id;
      const child = append(result.project, result.nodeId, 'dialogue', outletId);
      assert.equal(child.project.graph.edges.find(edge => edge.source === result.nodeId && edge.sourceHandle === outletId).target, child.nodeId);
      assert.equal(child.project.dialogue.nodes[child.nodeId].dialogue.style, 'Default_UI');
    });
    test('Branching before a condition retains the original continuation as the first choice', () => {
      const { project, ids } = sequence();
      project.dialogue.conditionBranches.Q = createConditionBranchNode('Q');
      project.graph.nodes.push({ id: 'view-Q', type: 'condition', data: { conditionBranchNodeId: 'Q' }, position: { x: 1, y: 1 } });
      project.graph.edges.push({ id: 'to-Q', source: ids[2], sourceHandle: 'next', target: 'view-Q' });
      const result = append(project, ids[0], 'select');
      const edge = result.project.graph.edges.find((edge) => edge.id === 'to-Q');
      assert.equal(edge.target, 'view-Q');
      assert.equal(edge.source, result.nodeId);
      assert.equal(edge.sourceHandle, `select:${result.project.dialogue.nodes[result.nodeId].select.options[0].id}`);
    });
    test('Collection remains fully reorderable before a separate option card', () => {
      const { project, ids } = sequence();
      const branched = append(project, ids[0], 'select');
      const moved = act(branched.project, { type: 'move', nodeId: ids[1], targetId: ids[2] });
      assert.deepEqual(lineIds(moved.project)[0], [ids[0], ids[2], ids[1]]);
      assert.equal(moved.project.graph.edges.find(edge => edge.target === branched.nodeId).source, ids[1]);
      const added = append(branched.project, ids[0], 'dialogue');
      assert.deepEqual(lineIds(added.project)[0], [...ids, added.nodeId]);
      assert.equal(added.project.graph.edges.find(edge => edge.target === branched.nodeId).source, added.nodeId);
    });
    test('A condition node is created separately and the selected outlet continues into a new collection', () => {
      const { project, ids } = sequence();
      const result = append(project, ids[0], 'condition');
      const condition = result.project.dialogue.conditionBranches[result.nodeId];
      assert.ok(condition);
      assert.equal(result.project.dialogue.nodes[result.nodeId], undefined);
      const child = append(result.project, result.nodeId, 'dialogue', condition.outputs[0].id);
      assert.deepEqual(preview(child.project).blocks.map(block => block.kind), ['entry', 'dialogue', 'condition', 'dialogue']);
      assert.deepEqual(preview(decode(encode(child.project))).blocks.map(block => block.kind), ['entry', 'dialogue', 'condition', 'dialogue']);
    });
    test('Connect a fragment, detach it again, and reject stale targets without data loss', () => {
      const { project, ids } = sequence();
      const fragment = act(project, { type: 'create' });
      const sourceBlock = preview(fragment.project).blocks.find((block) => block.lines[0]?.nodeId === ids[0]);
      const targetBlock = preview(fragment.project).blocks.find((block) => !block.reachable);
      const joined = act(fragment.project, { type: 'connect', blockId: sourceBlock.id, outletId: 'next', targetId: targetBlock.id });
      assert.deepEqual(lineIds(joined.project), [[...ids, fragment.nodeId]]);
      assert.ok(preview(joined.project).blocks.every((block) => block.reachable));
      const entry = preview(joined.project).blocks.find((block) => block.kind === 'entry');
      const detached = act(joined.project, { type: 'connect', blockId: entry.id, outletId: 'next', targetId: '' });
      assert.equal(preview(detached.project).blocks.filter((block) => !block.reachable).length, 1);
      assert.equal(act(joined.project, { type: 'connect', blockId: entry.id, outletId: 'next', targetId: 'missing' }), undefined);
    });
    test('Reordering in a returning passage keeps the loop and entry attached to its new head', () => {
      const { project, ids } = sequence();
      project.graph.edges.push({ id: 'return', source: ids[2], sourceHandle: 'next', target: ids[0] });
      const result = act(project, { type: 'move', nodeId: ids[0], targetId: ids[1] });
      assert.deepEqual(lineIds(result.project), [[ids[1], ids[0], ids[2]]]);
      assert.equal(result.project.graph.edges.find((edge) => edge.id === 'return').target, ids[1]);
    });
    test('Condition and dialogue aliases with the same business ID do not steal each other’s connections', () => {
      const { project, ids } = sequence();
      const condition = createConditionBranchNode(ids[0]);
      project.dialogue.conditionBranches[ids[0]] = condition;
      project.graph.nodes.unshift({ id: 'condition-alias', type: 'condition', data: { conditionBranchNodeId: ids[0] }, position: { x: 1200, y: 200 } });
      const entry = preview(project).blocks.find((block) => block.kind === 'entry');
      const connected = act(project, { type: 'connect', blockId: entry.id, outletId: 'next', targetId: `condition:${ids[0]}` }).project;
      assert.equal(connected.graph.edges.find((edge) => edge.source === entry.nodeIds[0]).target, 'condition-alias');
      const result = act(connected, { type: 'connect', blockId: `condition:${ids[0]}`, outletId: condition.outputs[0].id, targetId: `group:${ids[0]}` }).project;
      const edge = result.graph.edges.find((edge) => edge.source === 'condition-alias');
      assert.equal(edge.target, ids[0]);
      assert.ok(preview(result).blocks.every((block) => block.reachable));
      assert.deepEqual(lineIds(act(result, { type: 'move', nodeId: ids[0], targetId: ids[1] }).project), [[ids[1], ids[0], ids[2]]]);
    });
    test('Adding text to a select-only passage does not introduce a next outlet', () => {
      const { project, ids } = sequence();
      const branched = append(project, ids[0], 'select');
      const result = act(branched.project, { type: 'add-dialogue', nodeId: branched.nodeId });
      assert.equal(result.project.dialogue.nodes[branched.nodeId].dialogue.content, '');
      assert.equal(result.project.dialogue.nodes[branched.nodeId].dialogue.advanceMode, 'None');
      assert.deepEqual(lineIds(result.project), [ids, [branched.nodeId]]);
    });
    test('Deleting one option removes only its outlet, keeps downstream content, and supports the last option', () => {
      const { project, ids } = sequence();
      const choice = append(project, ids[0], 'select');
      const blockId = `group:${choice.nodeId}`;
      const options = choice.project.dialogue.nodes[choice.nodeId].select.options;
      const child = append(choice.project, choice.nodeId, 'dialogue', `select:${options[0].id}`);
      const before = encode(child.project);
      const removed = act(child.project, { type: 'delete-outlet', blockId, outletId: `select:${options[0].id}` });
      assert.deepEqual(removed.project.dialogue.nodes[choice.nodeId].select.options.map(option => option.id), [options[1].id]);
      assert.ok(removed.project.dialogue.nodes[child.nodeId]);
      assert.equal(preview(removed.project).blocks.find(block => block.nodeIds.includes(child.nodeId)).reachable, false);
      assert.ok(removed.project.graph.edges.every(edge => edge.sourceHandle !== `select:${options[0].id}`));
      assert.equal(encode(child.project), before);
      const undo = captureDeletion(child.project, removed.project, '', blockId);
      assert.equal(encode(undo.project), before);
      assert.equal(canUndoDeletion(undo, removed.project), true);
      assert.equal(undo.blockId, blockId);
      assert.equal(act(removed.project, { type: 'delete-outlet', blockId, outletId: `select:${options[0].id}` }), undefined);
      const last = act(removed.project, { type: 'delete-outlet', blockId, outletId: `select:${options[1].id}` });
      assert.equal(last.project.dialogue.nodes[choice.nodeId].select.options.length, 0);
      assert.equal(act(last.project, { type: 'add-option', nodeId: choice.nodeId }).project.dialogue.nodes[choice.nodeId].select.options.length, 1);
    });
    test('Deleting a collection removes every contained Group and Clip and reconnects its external continuation', () => {
      const { project, ids } = sequence();
      project.dialogue.nodes[ids[1]].lines[0].clips.push(createPerformanceClip('Camera'));
      const choice = append(project, ids[0], 'select');
      const block = preview(choice.project).blocks.find(block => block.nodeIds.includes(ids[0]));
      const before = encode(choice.project);
      const removed = act(choice.project, { type: 'delete-block', blockId: block.id });
      ids.forEach(id => assert.equal(removed.project.dialogue.nodes[id], undefined));
      assert.ok(removed.project.dialogue.nodes[choice.nodeId]);
      assert.ok(removed.project.graph.edges.some(edge => edge.source === project.dialogue.entryNodeId && edge.target === choice.nodeId));
      assert.equal(encode(captureDeletion(choice.project, removed.project, '', block.id).project), before);
      assert.equal(encode(choice.project), before);
      assert.equal(act(removed.project, { type: 'delete-block', blockId: block.id }), undefined);
      assert.equal(act(removed.project, { type: 'delete-block', blockId: `entry:${project.dialogue.entryNodeId}` }), undefined);
      const cyclic = sequence();
      cyclic.project.graph.edges.push({ id: 'return-all', source: cyclic.ids[2], target: cyclic.ids[0], sourceHandle: 'next' });
      const cycleBlock = preview(cyclic.project).blocks.find(block => block.kind === 'dialogue');
      const gone = act(cyclic.project, { type: 'delete-block', blockId: cycleBlock.id });
      assert.equal(Object.keys(gone.project.dialogue.nodes).length, 0);
      assert.equal(gone.project.graph.edges.length, 0);
    });
    test('Deleting a choice node never deletes or implicitly selects one of its downstream branches', () => {
      const { project, ids } = sequence();
      const choice = append(project, ids[0], 'select');
      const options = choice.project.dialogue.nodes[choice.nodeId].select.options;
      const left = append(choice.project, choice.nodeId, 'dialogue', `select:${options[0].id}`);
      const right = append(left.project, choice.nodeId, 'dialogue', `select:${options[1].id}`);
      const removed = act(right.project, { type: 'delete-block', blockId: `group:${choice.nodeId}` });
      assert.equal(removed.project.dialogue.nodes[choice.nodeId], undefined);
      assert.ok(removed.project.dialogue.nodes[left.nodeId] && removed.project.dialogue.nodes[right.nodeId]);
      assert.ok(removed.project.graph.edges.every(edge => edge.source !== choice.nodeId && edge.target !== choice.nodeId));
      assert.equal(preview(removed.project).blocks.filter(block => !block.reachable).length, 2);
      assert.deepEqual(lineIds(decode(encode(removed.project))), lineIds(removed.project));
    });
    test('Condition item and whole-node deletion respect aliases and same-ID dialogue, including undo focus', () => {
      const { project, ids } = sequence();
      const condition = createConditionBranchNode(ids[0]);
      project.dialogue.conditionBranches[ids[0]] = condition;
      project.graph.nodes.unshift({ id: 'condition-delete-alias', type: 'condition', data: { conditionBranchNodeId: ids[0] }, position: { x: 0, y: 0 } });
      project.graph.edges.push({ id: 'condition-edge', source: 'condition-delete-alias', target: ids[0], sourceHandle: condition.outputs[0].id });
      const blockId = `condition:${ids[0]}`;
      const itemGone = act(project, { type: 'delete-outlet', blockId, outletId: condition.outputs[0].id });
      assert.equal(itemGone.project.dialogue.conditionBranches[ids[0]].outputs.length, condition.outputs.length - 1);
      assert.ok(itemGone.project.dialogue.nodes[ids[0]]);
      assert.ok(itemGone.project.graph.edges.every(edge => edge.id !== 'condition-edge'));
      const gone = act(project, { type: 'delete-block', blockId });
      assert.equal(gone.project.dialogue.conditionBranches[ids[0]], undefined);
      assert.ok(gone.project.dialogue.nodes[ids[0]]);
      assert.ok(gone.project.graph.nodes.some(node => node.id === ids[0]));
      assert.ok(gone.project.graph.nodes.every(node => node.id !== 'condition-delete-alias'));
      const undo = captureDeletion(project, gone.project, '', blockId);
      assert.equal(undo.blockId, blockId);
      assert.equal(encode(undo.project), encode(project));
    });
    console.log(`\n${count} text structure checks passed.`);
  } finally {
    Module._load = previousLoad;
    if (previousTs) Module._extensions['.ts'] = previousTs; else delete Module._extensions['.ts'];
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
