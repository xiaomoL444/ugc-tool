/* Run: node scripts/test-client-ui-gia-types.cjs [native-ui.gia template.gia ...] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

async function main() {
  const converter = await import('genshin-impact-ugc-file-converter-web');
  const oldLoad = Module._load, oldTs = Module._extensions['.ts'];
  Module._load = function (request, parent, isMain) { return request === 'genshin-impact-ugc-file-converter-web' ? converter : oldLoad.call(this, request, parent, isMain); };
  const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  Module._extensions['.ts'] = (module, file) => module._compile(transpile(fs.readFileSync(file, 'utf8')), file);
  try {
    const directory = path.resolve(__dirname, '../src/views/ClientUIAnimationEditor');
    const { exportGiaUI, originalGiaUIIndex, normalizeGiaExportSource } = require(path.join(directory, 'giaExporter.ts'));
    const { importGiaControls, detectGiaAssetKind } = require(path.join(directory, 'giaImporter.ts'));
    const { createControlProperties } = require(path.join(directory, 'controlRegistry.ts'));
    const clone = value => JSON.parse(JSON.stringify(value));
    const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
    const primary = document => list(document.json['1'])[0];
    const rawControls = document => [...(detectGiaAssetKind(document.json) === 'controlTemplate' ? [primary(document)] : []), ...list(document.json['2'])];
    function node(type, id, parentId = null) {
      return { id, type, parentId, name: `控件-${id}`, active: true, visible: true, locked: false, canControllerFocus: false,
        x: 800, y: 450, width: 150, height: 80, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 25.5,
        anchorMinX: .5, anchorMinY: .5, anchorMaxX: .5, anchorMaxY: .5, pivotX: .5, pivotY: .5,
        anchorOffsetX: 12.25, anchorOffsetY: -9.75, sizeDeltaX: 150, sizeDeltaY: 80, properties: createControlProperties(type) };
    }
    function nodesFrom(imported) {
      const known = new Set(imported.controls.map(control => control.sourceNodeIndex));
      return imported.controls.map(control => {
        const l = control.layout;
        return { ...node(control.type, `gia_node_${control.sourceNodeIndex}`, known.has(control.parentSourceNodeIndex) ? `gia_node_${control.parentSourceNodeIndex}` : null),
          name: control.name, active: l.active, scaleX: l.scaleX, scaleY: l.scaleY, scaleZ: l.scaleZ,
          rotationX: l.rotationX, rotationY: l.rotationY, rotation: l.rotationZ,
          anchorMinX: l.anchorMinX, anchorMinY: l.anchorMinY, anchorMaxX: l.anchorMaxX, anchorMaxY: l.anchorMaxY,
          pivotX: l.pivotX, pivotY: l.pivotY, anchorOffsetX: l.anchoredPositionX, anchorOffsetY: l.anchoredPositionY,
          sizeDeltaX: l.sizeDeltaX, sizeDeltaY: l.sizeDeltaY, properties: { ...createControlProperties(control.type), ...control.properties } };
      });
    }
    function checkShape(output, assetKind, count, index) {
      const decoded = converter.decode(output.bytes, { type: 'gia' });
      const asset = primary(decoded), pool = list(decoded.json['2']);
      assert.equal(detectGiaAssetKind(decoded.json), assetKind);
      assert.equal(importGiaControls(buffer(output.bytes)).assetKind, assetKind);
      assert.equal(asset['5'], assetKind === 'controlTemplate' ? 70 : 21);
      assert.equal(pool.length, count - (assetKind === 'controlTemplate' ? 1 : 0));
      assert.equal(originalGiaUIIndex({ document: decoded, deviceIndex: 0 }), index);
      const wrapper = list(asset['19']['1']['505']).find(component => '72' in component);
      assert.equal(Boolean(wrapper), assetKind === 'containerUI');
      if (assetKind === 'controlTemplate') {
        assert.equal(asset['19']['1']['504'], undefined);
        assert.ok(pool.every(raw => raw['1']['4'] !== asset['1']['4']), 'template root must not be duplicated in the member pool');
        assert.ok(list(asset['2']).every(ref => ref['4'] !== asset['1']['4']), 'template root cannot reference itself as a child');
        assert.deepEqual(list(asset['19']['1']['502']).map(attribute => attribute['501']).sort(), [1, 2, 4]);
      }
      return decoded;
    }
    const fresh = [node('container', 'root'), node('image', 'upper', 'root'), node('text', 'lower', 'root')];
    fresh[2].properties.text = '模板中的中文';
    const freshBefore = clone(fresh);
    const template = exportGiaUI({ name: '模板资产名', uiIndex: 37, assetKind: 'controlTemplate', deviceIndex: 0, nodes: fresh });
    checkShape(template, 'controlTemplate', fresh.length, 37);
    for (let device = 0; device < 4; device++) {
      const imported = importGiaControls(buffer(template.bytes), device);
      assert.equal(imported.projectName, '模板资产名');
      assert.deepEqual(imported.controls.map(control => control.name), fresh.map(control => control.name));
      assert.equal(imported.controls[1].layout.anchoredPositionX, 12.25);
      assert.equal(imported.controls[2].properties.text, '模板中的中文');
    }
    assert.deepEqual(fresh, freshBefore);
    const image = exportGiaUI({ name: '单图片模板', uiIndex: 0, assetKind: 'controlTemplate', deviceIndex: 0, nodes: [node('image', 'image')] });
    checkShape(image, 'controlTemplate', 1, 0);
    assert.equal(importGiaControls(buffer(image.bytes)).controls[0].type, 'image');
    assert.throws(() => exportGiaUI({ name: 'UI', uiIndex: 1, assetKind: 'containerUI', deviceIndex: 0, nodes: [node('image', 'image')] }), /根控件必须是容器/);
    assert.throws(() => exportGiaUI({ name: '模板', uiIndex: 1, assetKind: 'controlTemplate', deviceIndex: 0, nodes: [node('image', 'a'), node('text', 'b')] }), /一个根控件/);
    assert.throws(() => exportGiaUI({ name: '模板', uiIndex: 1, assetKind: 'wrong', deviceIndex: 0, nodes: fresh }), /导出类型/);
    console.log('PASS fresh template structure, separate asset/control names, root-only image templates, four layouts and export validation');

    function checkConversions(bytes, label) {
      const original = importGiaControls(buffer(bytes));
      const nodes = nodesFrom(original);
      const source = normalizeGiaExportSource(JSON.parse(JSON.stringify({ document: original.sourceDocument, baseline: clone(nodes), deviceIndex: 0 })));
      const sourceBefore = clone(source);
      for (const assetKind of ['containerUI', 'controlTemplate']) {
        const output = exportGiaUI({ name: '转换后的资产名', uiIndex: 55, assetKind, nodes, source, deviceIndex: 0 });
        const document = checkShape(output, assetKind, nodes.length, 55);
        for (let device = 0; device < 4; device++) {
          const before = importGiaControls(buffer(bytes), device).controls;
          const after = importGiaControls(buffer(output.bytes), device).controls;
          assert.deepEqual(after.map(control => [control.name, control.type, control.layout, control.properties]), before.map(control => [control.name, control.type, control.layout, control.properties]));
          const ids = new Map(before.map((control, i) => [control.sourceNodeIndex, after[i].sourceNodeIndex]));
          assert.deepEqual(after.map(control => [control.parentSourceNodeIndex, control.childSourceNodeIndices]), before.map(control => [ids.get(control.parentSourceNodeIndex) ?? control.parentSourceNodeIndex, control.childSourceNodeIndices.map(id => ids.get(id))]));
        }
        // Editing the imported template root used to recreate its native components.
        const changedNodes = clone(nodes);
        changedNodes[0].anchorOffsetX += 7.25;
        const changed = exportGiaUI({ name: '修改后的资产', uiIndex: 56, assetKind, nodes: changedNodes, source, deviceIndex: 0 });
        assert.equal(importGiaControls(buffer(changed.bytes)).controls[0].layout.anchoredPositionX, changedNodes[0].anchorOffsetX);
        for (let device = 1; device < 4; device++) assert.deepEqual(importGiaControls(buffer(changed.bytes), device).controls.map(control => control.layout), importGiaControls(buffer(bytes), device).controls.map(control => control.layout));
        const unknown = rawControls(document)[0]['19']['1']['505'].find(component => '190' in component);
        if (unknown) assert.equal(unknown['503']['191']['501'], 3.25, 'unknown float wire types must follow the root when moving between fields');
        assert.deepEqual(source, sourceBefore, 'export must preserve saved source data');
        // Reopen the output, then export in the opposite format as well.
        const reread = importGiaControls(buffer(output.bytes)), reopened = nodesFrom(reread);
        const opposite = assetKind === 'controlTemplate' ? 'containerUI' : 'controlTemplate';
        const back = exportGiaUI({ name: '再次转换', uiIndex: 57, assetKind: opposite, nodes: reopened, deviceIndex: 0,
          source: { document: reread.sourceDocument, baseline: clone(reopened), deviceIndex: 0 } });
        checkShape(back, opposite, nodes.length, 57);
        assert.deepEqual(importGiaControls(buffer(back.bytes)).controls.map(control => control.name), nodes.map(control => control.name));
      }
      console.log(`PASS ${label}: both export formats, reopening, hierarchy, native root edits, other devices and saved provenance`);
    }
    checkConversions(template.bytes, 'generated template');
    const nativeUI = exportGiaUI({ name: '原始 UI', uiIndex: 12, deviceIndex: 0, nodes: fresh });
    const root = nativeUI.document.json['2'][0];
    root['19']['1']['505'].push({ '190': 'base64:', '501': 180, '502': 199, '503': { '191': { '501': 3.25 } } });
    nativeUI.document.dtype_csv += '\n2/19/1/505/190,,data\n2/19/1/505/503/191,,object\n2/19/1/505/503/191/501,,float32';
    checkConversions(converter.encode(nativeUI.document, { type: 'gia' }), 'UI with an unknown float component');
    for (const file of process.argv.slice(2)) checkConversions(fs.readFileSync(file), path.basename(file));

    for (const file of ['GiaExportDialog.vue', 'ClientUIAnimationEditor.vue']) {
      const { descriptor, errors } = parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      assert.deepEqual(errors, []);
      const compiled = compileScript(descriptor, { id: 'gia-types-test' });
      const rendered = compileTemplate({ source: descriptor.template.content, filename: file, id: 'gia-types-test', compilerOptions: { bindingMetadata: compiled.bindings } });
      assert.deepEqual(rendered.errors, []);
      if (file !== 'GiaExportDialog.vue') continue;
      const ast = ts.createSourceFile('dialog.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const declarations = ast.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(ast)).join('\n');
      for (const initialKind of ['containerUI', 'controlTemplate']) {
        const props = vue.reactive({ projectName: '  导出名称  ', initialIndex: 37, initialKind, count: 3, hasSource: true, busy: false, error: '', notice: '' });
        const events = [], exports = {};
        const context = vm.createContext({ ...vue, defineProps: () => props, defineEmits: () => (...args) => events.push(args),
          onMounted: () => {}, onBeforeUnmount: () => {}, require: request => request === 'vue' ? vue : require(request), exports });
        const scope = vue.effectScope();
        try {
          scope.run(() => vm.runInContext(transpile(declarations + '\nglobalThis.api = { name, index, assetKind, emit, fileInput, dialog, loadSource };'), context));
          vm.runInContext(transpile(rendered.code), context);
          const setup = vue.reactive(context.api);
          assert.equal(setup.assetKind, initialKind);
          const find = (node, type) => {
            if (node?.type === type) return node;
            for (const child of Array.isArray(node?.children) ? node.children : []) { const found = find(child, type); if (found) return found; }
          };
          let tree = exports.render({}, [], props, setup, {}, {});
          find(tree, 'select').props['onUpdate:modelValue']('controlTemplate');
          setup.index = '82';
          tree = exports.render({}, [], props, setup, {}, {});
          assert.equal(find(tree, 'select').props['aria-label'], 'GIA 导出类型');
          const inputs = [];
          function collect(node) { if (node?.type === 'input') inputs.push(node); for (const child of Array.isArray(node?.children) ? node.children : []) collect(child); }
          collect(tree);
          assert.ok(inputs.some(input => input.props['aria-label'] === '控件模板索引'));
          find(tree, 'form').props.onSubmit({ preventDefault() {} });
          assert.deepEqual(clone(events.at(-1)), ['export', { name: '导出名称', uiIndex: 82, assetKind: 'controlTemplate' }]);
          find(tree, 'select').props['onUpdate:modelValue']('containerUI');
          exports.render({}, [], props, setup, {}, {});
          find(exports.render({}, [], props, setup, {}, {}), 'form').props.onSubmit({ preventDefault() {} });
          assert.equal(events.at(-1)[1].assetKind, 'containerUI');
        } finally { scope.stop(); }
      }
    }
    console.log('PASS actual editor/dialog SFC compilation and dialog default, format switching, index labels and submitted export options');
  } finally { Module._load = oldLoad; if (oldTs) Module._extensions['.ts'] = oldTs; else delete Module._extensions['.ts']; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
