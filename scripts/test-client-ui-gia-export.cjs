/* Real native codec round trips; optional arguments are original client UI GIA files. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
async function main() {
  const converter = await import("genshin-impact-ugc-file-converter-web"), oldLoad = Module._load, oldTs = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) { return request === "genshin-impact-ugc-file-converter-web" ? converter : oldLoad.call(this, request, parent, isMain); };
  Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, file);
  try {
    const { exportGiaUI, originalGiaUIIndex, createGiaExportBaseline } = require("../src/views/ClientUIAnimationEditor/giaExporter.ts");
    const { importGiaControls } = require("../src/views/ClientUIAnimationEditor/giaImporter.ts");
    const { createControlProperties } = require("../src/views/ClientUIAnimationEditor/controlRegistry.ts");
    const clone = value => JSON.parse(JSON.stringify(value));
    const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const objects = value => Array.isArray(value) ? value : value ? [value] : [];
    const typedIds = (value, ids) => {
      if (Array.isArray(value)) return value.map(item => typedIds(item, ids));
      if (!value || typeof value !== 'object') return value;
      const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typedIds(item, ids)]));
      if (value['2'] === 1 && value['3'] === 8 && ids.has(value['4'])) result['4'] = ids.get(value['4']);
      return result;
    };
    const remapImported = (control, ids) => ({ ...control, sourceNodeIndex: ids.get(control.sourceNodeIndex) ?? control.sourceNodeIndex,
      parentSourceNodeIndex: ids.get(control.parentSourceNodeIndex) ?? control.parentSourceNodeIndex,
      childSourceNodeIndices: control.childSourceNodeIndices.map(id => ids.get(id) ?? id) });
    const importedNodes = original => original.controls.map(control => { const l = control.layout; return node(control.type, `gia_node_${control.sourceNodeIndex}`, control.parentSourceNodeIndex === null ? null : `gia_node_${control.parentSourceNodeIndex}`, {
      name: control.name, active: l.active, scaleX: l.scaleX, scaleY: l.scaleY, scaleZ: l.scaleZ,
      rotationX: l.rotationX, rotationY: l.rotationY, rotation: l.rotationZ, anchorMinX: l.anchorMinX, anchorMinY: l.anchorMinY, anchorMaxX: l.anchorMaxX, anchorMaxY: l.anchorMaxY,
      pivotX: l.pivotX, pivotY: l.pivotY, anchorOffsetX: l.anchoredPositionX, anchorOffsetY: l.anchoredPositionY, sizeDeltaX: l.sizeDeltaX, sizeDeltaY: l.sizeDeltaY,
      properties: { ...createControlProperties(control.type), ...control.properties },
    }); });
    function node(type, id, parentId = null, overrides = {}) { return {
      id, type, name: `测试-${id}`, parentId, active: true, visible: true, locked: false, canControllerFocus: false,
      x: 800, y: 450, width: 150, height: 80, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 0,
      anchorMinX: .5, anchorMinY: .5, anchorMaxX: .5, anchorMaxY: .5, pivotX: .5, pivotY: .5,
      anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 150, sizeDeltaY: 80, properties: createControlProperties(type), ...overrides,
    }; }
    const fresh = [node("container", "root"), node("image", "top", "root", { rotation: 45, scaleX: -.25, scaleY: 2, anchorOffsetX: 12.25 }), node("text", "bottom", "root")];
    fresh[2].properties.text = "中文\n<color=#ff0000>文本</color>";
    fresh[1].properties.imageColor = { r: 120, g: 200, b: 20, a: .5 };
    const before = clone(fresh), exported = exportGiaUI({ name: "测试 UI", uiIndex: 32, deviceIndex: 0, nodes: fresh });
    assert.deepEqual(fresh, before);
    const imported = importGiaControls(buffer(exported.bytes));
    assert.equal(imported.controls.length, 3, "UI wrapper is not an extra container");
    assert.deepEqual(imported.controls.map(c => c.name), fresh.map(n => n.name));
    assert.equal(imported.controls[1].layout.scaleX, -.25);
    assert.equal(imported.controls[1].layout.rotationZ, 45);
    assert.equal(imported.controls[2].properties.text, fresh[2].properties.text);
    assert.equal(imported.controls[1].properties.imageColor.a, 128 / 255);
    for (let device = 0; device < 4; device++) assert.equal(importGiaControls(buffer(exported.bytes), device).controls[1].layout.anchoredPositionX, 12.25);
    assert.equal(originalGiaUIIndex({ document: exported.document, deviceIndex: 0 }), 32);
    assert.deepEqual(exported.document.json['2'].map(raw => raw['1']['4']), [1073741825, 1073741826, 1073741827]);
    console.log("PASS fresh native UI: wrapper, hierarchy, sibling order, four layouts, negative scale, rotation, Unicode and color");
    const references = [node("container", "reference-root"), node("reference", "reference", "reference-root"), node("uiAnimation", "effect", "reference-root")];
    references[1].properties.referencedPrefabIndex = 1073746851;
    references[2].properties.animationId = 10001145;
    const referenceOutput = exportGiaUI({ name: "Reference UI", uiIndex: 33, deviceIndex: 0, nodes: references });
    const referenceControls = importGiaControls(buffer(referenceOutput.bytes)).controls;
    assert.equal(referenceControls[1].type, "reference"); assert.equal(referenceControls[1].properties.referencedPrefabIndex, 1073746851);
    assert.equal(referenceControls[2].type, "uiAnimation"); assert.equal(referenceControls[2].properties.animationId, 10001145);
    console.log("PASS template reference indices and UI animation identifiers use their observed native components");
    const primitives = [node("container", "primitive-root"), node("primitive", "primitive", "primitive-root", { scaleX: 1.5, rotation: 35, anchorOffsetX: -20 }), node("text", "primitive-child", "primitive")];
    primitives[1].properties.imageUrl = "data:image/png;base64,CUSTOM_IMAGE_EDITOR_ONLY";
    const primitiveBefore = clone(primitives);
    const primitiveOutput = exportGiaUI({ name: "Primitive UI", uiIndex: 34, deviceIndex: 0, nodes: primitives });
    const primitiveControls = importGiaControls(buffer(primitiveOutput.bytes)).controls;
    assert.equal(primitiveControls[1].type, "container");
    assert.equal(primitiveControls[1].layout.scaleX, 1.5); assert.equal(primitiveControls[1].layout.rotationZ, 35);
    assert.equal(primitiveControls[1].layout.anchoredPositionX, -20);
    assert.equal(primitiveControls[2].parentSourceNodeIndex, primitiveControls[1].sourceNodeIndex);
    assert.equal(JSON.stringify(primitiveOutput.document.json).includes("CUSTOM_IMAGE_EDITOR_ONLY"), false);
    assert.deepEqual(primitives, primitiveBefore, "Export cannot replace the custom editor node or discard its image reference");
    console.log("PASS custom primitives export as ordinary containers with unchanged transforms and children, without image data or editor mutation");
    const mouths = [node('container', 'mouth-root'), ...['嘴3', '嘴2', '嘴1'].map(name => node('primitive', name, 'mouth-root', { visible: false, active: true }))];
    mouths[1].canControllerFocus = true;
    const mouthsBefore = clone(mouths);
    const hiddenOutput = exportGiaUI({ name: '隐藏嘴型', uiIndex: 35, deviceIndex: 0, nodes: mouths });
    const hiddenControls = importGiaControls(buffer(hiddenOutput.bytes)).controls;
    assert.equal(hiddenControls.length, 4);
    assert.ok(hiddenControls.every(control => control.type === 'container' && control.layout.active), 'visibility must not be implemented by deactivating the container');
    assert.deepEqual(mouths, mouthsBefore, 'GIA placeholders must not overwrite saved visibility/focus');
    console.log('PASS hidden PSD mouth primitives export successfully as active placeholders; Lua owns visibility/focus');
    // A sparse native document includes an old ID overlapping the new block.
    // Its image ID intentionally equals an old control ID, but is not a reference.
    const sparseIds = new Map([[1073741825, 1000000010], [1073741826, 1073741825], [1073741827, 1800000000], [1073741828, 1900000000]]);
    const sparse = clone(exported.document);
    sparse.json = typedIds(sparse.json, sparseIds);
    const pack = ids => { const bytes = []; for (let id of ids) do { const byte = id % 128; id = Math.floor(id / 128); bytes.push(byte | (id ? 128 : 0)); } while (id); return `base64:${Buffer.from(bytes).toString('base64')}`; };
    for (const raw of [sparse.json['1'], ...sparse.json['2']]) {
      const meta = raw['19']['1']; meta['501'] = raw['1']['4'];
      for (const attr of objects(meta['502'])) {
        if (attr['11']) attr['11']['501'] = raw['1']['4'];
        if (attr['14']) attr['14']['501'] = pack([1000000010]);
      }
      if (meta['504']) meta['504'] = sparseIds.get(meta['504']);
      if (meta['503']) meta['503'] = pack(objects(raw['2']).map(ref => ref['4']));
      const wrapper = meta['505'].find(c => c['72'] !== undefined);
      if (wrapper) wrapper['503']['73']['501'] = 1000000010;
    }
    const imageComponent = sparse.json['2'][1]['19']['1']['505'].find(c => c['83'] !== undefined);
    imageComponent['503']['84']['503'] = 1000000010;
    const sparseImported = importGiaControls(buffer(converter.encode(sparse, { type: 'gia' })));
    const sparseNodes = importedNodes(sparseImported), sparseSource = { document: sparseImported.sourceDocument, baseline: clone(sparseNodes), deviceIndex: 0 };
    const sourceBefore = clone(sparseSource);
    const sequential = exportGiaUI({ name: 'Reindexed', uiIndex: 32, deviceIndex: 0, nodes: sparseNodes, source: sparseSource });
    const remapped = importGiaControls(buffer(sequential.bytes));
    assert.deepEqual(remapped.controls.map(c => c.sourceNodeIndex), [1073741825, 1073741826, 1073741827]);
    assert.equal(remapped.controls[1].properties.imageId, 1000000010);
    const idMap = new Map(sparseImported.controls.map((c, i) => [c.sourceNodeIndex, remapped.controls[i].sourceNodeIndex]));
    assert.deepEqual(remapped.controls, sparseImported.controls.map(c => remapImported(c, idMap)));
    for (const raw of sequential.document.json['2']) {
      const meta = raw['19']['1'], id = raw['1']['4'];
      assert.equal(meta['501'], id); assert.equal(objects(meta['502']).find(a => a['11'])['11']['501'], id);
      for (const component of meta['505']) if (component['503']?.['504']) assert.equal(component['503']['504']['4'], id);
    }
    assert.equal(sequential.document.json['1']['1']['4'], 1073741828);
    const wrapper = sequential.document.json['1'];
    assert.equal(wrapper['19']['1']['501'], 1073741828);
    assert.equal(wrapper['19']['1']['505'].find(c => c['72'] !== undefined)['503']['73']['501'], 1073741825);
    assert.equal(objects(wrapper['19']['1']['502']).find(a => a['14'])['14']['501'], pack([1073741825]));
    assert.deepEqual(wrapper['2'].map(ref => ref['4']), [1073741825, 1073741827, 1073741826]);
    assert.deepEqual(sparseSource, sourceBefore);
    const reducedNodes = [sparseNodes[0], sparseNodes[2], node('container', 'added', sparseNodes[0].id)];
    const reduced = exportGiaUI({ name: 'Reindexed', uiIndex: 32, deviceIndex: 0, nodes: reducedNodes, source: sparseSource });
    assert.deepEqual(reduced.document.json['2'].map(raw => raw['1']['4']), [1073741825, 1073741826, 1073741827], 'deletion and insertion must not leave ID gaps');
    assert.equal(reduced.document.json['2'][2]['19']['1']['504'], 1073741825);
    const withDependency = clone(sparseSource);
    withDependency.document.json['2'].push({ '1': { '2': 1, '3': 8, '4': 1073741826 }, '3': 'string:external', '5': 99 });
    const shifted = exportGiaUI({ name: 'Reserved block', uiIndex: 32, deviceIndex: 0, nodes: sparseNodes, source: withDependency });
    assert.deepEqual(shifted.document.json['2'].slice(0, 3).map(raw => raw['1']['4']), [1073741827, 1073741828, 1073741829]);
    assert.equal(shifted.document.json['1']['1']['4'], 1073741830);
    assert.equal(shifted.document.json['2'][3]['1']['4'], 1073741826, 'external dependency reserves its existing identity');
    console.log('PASS sparse imported IDs are renumbered contiguously, including wrapper, owners and hierarchy; asset IDs and provenance stay intact');
    const invalid = clone(fresh); invalid[1].properties.enableMask = true;
    assert.throws(() => exportGiaUI({ name: "Invalid", uiIndex: 1, deviceIndex: 0, nodes: invalid }), /启用遮罩/);
    assert.throws(() => exportGiaUI({ name: "Invalid", uiIndex: 1, deviceIndex: 0, nodes: [node("container", "gia_node_123")] }), /原始 GIA/);
    const badTree = clone(fresh); badTree[1].parentId = "missing";
    assert.throws(() => exportGiaUI({ name: "Invalid", uiIndex: 1, deviceIndex: 0, nodes: badTree }), /父控件/);
    console.log("PASS unknown changed fields, old imports without provenance and malformed trees fail before download");
    for (const file of process.argv.slice(2)) {
      const bytes = buffer(fs.readFileSync(file)), original = importGiaControls(bytes);
      const nodes = original.controls.map(control => { const l = control.layout; return node(control.type, `gia_node_${control.sourceNodeIndex}`, control.parentSourceNodeIndex === null ? null : `gia_node_${control.parentSourceNodeIndex}`, {
        name: control.name, active: l.active, scaleX: l.scaleX, scaleY: l.scaleY, scaleZ: l.scaleZ,
        rotationX: l.rotationX, rotationY: l.rotationY, rotation: l.rotationZ, anchorMinX: l.anchorMinX, anchorMinY: l.anchorMinY, anchorMaxX: l.anchorMaxX, anchorMaxY: l.anchorMaxY,
        pivotX: l.pivotX, pivotY: l.pivotY, anchorOffsetX: l.anchoredPositionX, anchorOffsetY: l.anchoredPositionY, sizeDeltaX: l.sizeDeltaX, sizeDeltaY: l.sizeDeltaY,
        properties: { ...createControlProperties(control.type), ...control.properties },
      }); });
      const source = { document: original.sourceDocument, baseline: clone(nodes), deviceIndex: 0 }, args = { name: original.projectName, uiIndex: originalGiaUIIndex(source), deviceIndex: 0, nodes, source };
      const roundTrip = exportGiaUI(args), reread = importGiaControls(buffer(roundTrip.bytes));
      const idMap = new Map(original.controls.map((control, index) => [control.sourceNodeIndex, reread.controls[index].sourceNodeIndex]));
      assert.deepEqual(reread.controls, original.controls.map(control => remapImported(control, idMap)));
      const roundRaw = converter.decode(roundTrip.bytes, { type: "gia" }).json["2"];
      for (const originalNode of original.sourceDocument.json["2"]) {
        const result = roundRaw.find(n => n["1"]["4"] === (idMap.get(originalNode["1"]["4"]) ?? originalNode["1"]["4"]));
        assert.ok(result);
        assert.deepEqual(result["19"]["1"]["505"], typedIds(originalNode["19"]["1"]["505"], idMap), "Native components preserve every field except remapped control identities");
      }
      const edited = nodes.find(n => n.type === "image");
      if (edited) {
        edited.rotation = 28.5; edited.anchorOffsetY = -123.25; edited.properties.imageId = 100001;
        const revised = exportGiaUI(args), changed = importGiaControls(buffer(revised.bytes)).controls.find(n => n.sourceNodeIndex === idMap.get(Number(edited.id.slice(9))));
        assert.equal(changed.layout.rotationZ, 28.5); assert.equal(changed.layout.anchoredPositionY, -123.25); assert.equal(changed.properties.imageId, 100001);
        for (let device = 1; device < 4; device++) assert.deepEqual(importGiaControls(buffer(revised.bytes), device).controls.map(n => n.layout), importGiaControls(bytes, device).controls.map(n => n.layout));
      }
      const removed = nodes.find(n => !nodes.some(child => child.parentId === n.id) && n.id !== nodes[0].id);
      const reduced = exportGiaUI({ ...args, nodes: nodes.filter(n => n.id !== removed.id) });
      assert.equal(importGiaControls(buffer(reduced.bytes)).controls.length, original.controls.length - 1);
      assert.deepEqual(source.document, original.sourceDocument, "Export cannot mutate provenance");
      console.log(`PASS ${path.basename(file)}: ${nodes.length} controls, every original component preserved, edits applied, other devices retained, deletion consistent`);
    }
    assert.equal(createGiaExportBaseline(fresh, 1600, 900).length, fresh.length);
  } finally { Module._load = oldLoad; if (oldTs) Module._extensions[".ts"] = oldTs; else delete Module._extensions[".ts"]; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
