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
      assert.deepEqual(reread.controls, original.controls);
      const roundRaw = converter.decode(roundTrip.bytes, { type: "gia" }).json["2"];
      for (const originalNode of original.sourceDocument.json["2"]) {
        const result = roundRaw.find(n => n["1"]["4"] === originalNode["1"]["4"]);
        assert.ok(result);
        assert.deepEqual(result["19"]["1"]["505"], originalNode["19"]["1"]["505"], "Every untouched native component, including unknown fields, must survive exactly");
      }
      const edited = nodes.find(n => n.type === "image");
      if (edited) {
        edited.rotation = 28.5; edited.anchorOffsetY = -123.25; edited.properties.imageId = 100001;
        const revised = exportGiaUI(args), changed = importGiaControls(buffer(revised.bytes)).controls.find(n => n.sourceNodeIndex === Number(edited.id.slice(9)));
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
