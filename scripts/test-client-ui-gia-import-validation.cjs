/* Run: node scripts/test-client-ui-gia-import-validation.cjs [unsupported-asset-pack.gia ...] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');

async function main() {
  const converter = await import('genshin-impact-ugc-file-converter-web');
  const oldLoad = Module._load, oldTs = Module._extensions['.ts'];
  const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  Module._load = function (request, parent, isMain) { return request === 'genshin-impact-ugc-file-converter-web' ? converter : oldLoad.call(this, request, parent, isMain); };
  Module._extensions['.ts'] = (module, file) => module._compile(transpile(fs.readFileSync(file, 'utf8')), file);
  try {
    const dir = path.resolve(__dirname, '../src/views/ClientUIAnimationEditor');
    const registry = require(path.join(dir, 'controlRegistry.ts'));
    const importer = require(path.join(dir, 'giaImporter.ts'));
    const exporter = require(path.join(dir, 'giaExporter.ts'));
    const templates = require(path.join(dir, 'controlTemplates.ts'));
    const filename = path.join(dir, 'ClientUIAnimationEditor.vue');
    const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
    const ast = ts.createSourceFile(filename + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
    const functions = ['makeNode', 'makeRootContainer', 'roundLayout', 'createGiaProject', 'loadGiaFile'];
    const source = ast.statements.filter(s => ts.isFunctionDeclaration(s) && functions.includes(s.name?.text)).map(s => s.getText(ast)).join('\n');
    let nextId = 0, currentProject = 'existing project', created = 0;
    const archive = { error: { value: '' }, async createDocument(name, factory) { const data = await factory(); currentProject = data; created++; } };
    const context = vm.createContext({ ...registry, ...importer,
      ...require(path.join(dir, 'containerDirectionGuide.ts')),
      DEFAULT_CANVAS_WIDTH: 1600, DEFAULT_CANVAS_HEIGHT: 900, TIMELINE_MODEL_VERSION: 12,
      createId: () => `test-node-${++nextId}`, deviceMode: { value: 'pc' }, previewPresetId: { value: 'pc-16-9' },
      controlLabels: Object.fromEntries(Object.entries(registry.controlRegistry).map(([type, definition]) => [type, definition.label])),
      canvasWidth: { value: 1600 }, canvasHeight: { value: 900 }, deviceModes: [{ id: 'pc', label: 'PC' }],
      Error, archive, workspacePanelOpen: { value: false },
    });
    vm.runInContext(transpile(source + '\nglobalThis.api = { makeNode, createGiaProject, loadGiaFile };'), context);
    const { api } = context;
    const list = v => v === undefined ? [] : Array.isArray(v) ? v : [v];
    const buffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const clone = v => JSON.parse(JSON.stringify(v));
    const components = raw => list(raw['19']['1']['505']);
    const file = (bytes, name = 'fixture.gia') => ({ name, arrayBuffer: async () => buffer(bytes) });
    const nodes = [api.makeNode('container', 'nativeRoot', { id: 'root' }),
      api.makeNode('image', 'mask', { id: 'mask', parentId: 'root', properties: { ...registry.createControlProperties('image'), enableMask: true } }),
      api.makeNode('image', 'closedEye', { id: 'closed', parentId: 'mask' })];
    const nativeUI = exporter.exportGiaUI({ name: 'UI asset', uiIndex: 1, deviceIndex: 0, nodes }).document;
    const nativeTemplate = exporter.exportGiaUI({ name: 'Template asset', uiIndex: 2, assetKind: 'controlTemplate', deviceIndex: 0, nodes }).document;
    components(list(nativeTemplate.json['2'])[1]).find(c => '14' in c)['503']['14']['17']['503'] = 1;
    nativeTemplate.dtype_csv += '\n2/19/1/505/503/14/17/503,,int';
    for (const [kind, document] of [['containerUI', nativeUI], ['controlTemplate', nativeTemplate]]) {
      const bytes = converter.encode(document, { type: 'gia' });
      const imported = importer.importGiaControls(buffer(bytes));
      assert.equal(imported.assetKind, kind); assert.equal(imported.controls.length, 3);
      assert.equal(imported.controls.find(c => c.name === 'mask').properties.enableMask, true);
      if (kind === 'controlTemplate') assert.equal(imported.controls.find(c => c.name === 'closedEye').visible, false);
      const project = JSON.parse(await api.createGiaProject(file(bytes)));
      assert.equal(project.nodes.length, 3); assert.equal(project.nodes[0].id, `gia_node_${imported.controls[0].sourceNodeIndex}`);
      assert.equal(project.name, imported.projectName);
      assert.equal(templates.readControlTemplate(buffer(bytes), 'fixture.gia', 1).devices.length, 4);
      const legacyNodes = clone(project.nodes), legacySource = { document: imported.sourceDocument, baseline: clone(project.nodes), deviceIndex: 0 };
      legacyNodes.forEach(n => { if (n.type === 'image') n.properties.enableMask = false; });
      legacySource.baseline = clone(legacyNodes);
      exporter.restoreLegacyGiaImageMasks(legacyNodes, legacySource);
      assert.equal(legacyNodes.find(n => n.name === 'mask').properties.enableMask, true);
      legacyNodes.find(n => n.name === 'mask').properties.enableMask = false;
      exporter.restoreLegacyGiaImageMasks(legacyNodes, legacySource);
      assert.equal(legacyNodes.find(n => n.name === 'mask').properties.enableMask, false);
      const singularArray = clone(document); singularArray.json['1'] = list(singularArray.json['1']);
      assert.equal(importer.readGiaControls(singularArray.json, 0).assetKind, kind);
    }
    const image = exporter.exportGiaUI({ name: 'Image template', uiIndex: 0, assetKind: 'controlTemplate', deviceIndex: 0, nodes: [api.makeNode('image', 'image', { id: 'image' })] });
    const imageProject = JSON.parse(await api.createGiaProject(file(image.bytes)));
    assert.equal(imageProject.nodes.length, 2); assert.equal(imageProject.nodes[0].type, 'container');
    assert.equal(imageProject.nodes[1].parentId, imageProject.nodes[0].id);
    for (const assetKind of ['containerUI', 'controlTemplate']) {
      const output = exporter.exportGiaUI({ name: 'Wrapped image', uiIndex: 4, assetKind, deviceIndex: 0, nodes: imageProject.nodes,
        source: { ...imageProject.giaSource, baseline: clone(imageProject.nodes) } });
      assert.equal(importer.importGiaControls(buffer(output.bytes)).controls.length, 2);
    }
    console.log('PASS only single client UI/template assets, root-only image templates, visibility, masks and legacy mask migration');

    const pack = clone(nativeTemplate);
    pack.json['1'] = [clone(nativeTemplate.json['1']), clone(nativeTemplate.json['1'])];
    pack.dtype_csv += '\n1,*,object';
    const mixedPack = clone(pack); mixedPack.json['1'][1]['5'] = 99;
    const unknown = clone(nativeTemplate); unknown.json['1']['5'] = 99;
    const server = clone(nativeTemplate); server.json['1']['5'] = 20;
    const untyped = clone(nativeTemplate); delete untyped.json['1']['5'];
    const wrongTemplate = clone(nativeUI); wrongTemplate.json['1']['5'] = 70;
    const wrongUI = clone(nativeTemplate); wrongUI.json['1']['5'] = 21;
    const noTransform = clone(nativeTemplate); noTransform.json['1']['19']['1']['505'] = components(noTransform.json['1']).filter(c => !('11' in c));
    const noAsset = clone(nativeUI); delete noAsset.json['1'];
    const malformed = clone(nativeUI); malformed.json['1'] = 'string:invalid';
    const rejection = /仅支持导入客户端容器 UI|不支持导入资产包/;
    assert.equal(importer.detectGiaAssetKind(malformed.json), null);
    assert.throws(() => importer.readGiaControls(malformed.json, 0), rejection);
    async function reject(bytes, label) {
      assert.equal(importer.detectGiaAssetKind(converter.decode(bytes, { type: 'gia' }).json), null, label);
      assert.throws(() => importer.importGiaControls(buffer(bytes)), rejection, label);
      assert.throws(() => importer.importGiaControlTemplate(buffer(bytes)), rejection, label);
      assert.throws(() => templates.readControlTemplate(buffer(bytes), label, 1), rejection, label);
      await assert.rejects(api.createGiaProject(file(bytes, label)), rejection, label);
      const before = currentProject, count = created;
      const input = { files: [file(bytes, label)], value: 'selected' };
      await api.loadGiaFile({ target: input });
      assert.equal(currentProject, before, 'rejected file cannot replace the current project');
      assert.equal(created, count, 'rejected file cannot create a partial document');
      assert.match(archive.error.value, rejection); assert.equal(input.value, '');
    }
    for (const [name, document] of Object.entries({ pack, mixedPack, unknown, server, untyped, wrongTemplate, wrongUI, noTransform, noAsset })) {
      await reject(converter.encode(document, { type: 'gia' }), name + '.gia');
    }
    const withDependency = clone(nativeUI), dependency = clone(list(nativeTemplate.json['1'])[0]);
    dependency['1']['4'] = 1999999999; dependency['5'] = 99;
    withDependency.json['2'].push(dependency);
    assert.equal(importer.readGiaControls(withDependency.json, 0).controls.length, 3);
    for (const name of process.argv.slice(2)) { await reject(fs.readFileSync(name), path.basename(name)); console.log(`PASS rejected ${path.basename(name)}`); }
    console.log('PASS packages, mixed assets, other/server assets, missing or inconsistent type markers rejected at every import entry; current project retained');
  } finally { Module._load = oldLoad; if (oldTs) Module._extensions['.ts'] = oldTs; else delete Module._extensions['.ts']; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
