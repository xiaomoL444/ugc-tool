/* Native field calibration: node scripts/test-client-ui-gia-image-fields.cjs feather.gia reverse.gia fill.gia */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

async function main() {
  const converter = await import('genshin-impact-ugc-file-converter-web'), oldLoad = Module._load, oldTs = Module._extensions['.ts'];
  Module._load = function (request, parent, isMain) { return request === 'genshin-impact-ugc-file-converter-web' ? converter : oldLoad.call(this, request, parent, isMain); };
  Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
  try {
    const { exportGiaUI } = require('../src/views/ClientUIAnimationEditor/giaExporter.ts');
    const { importGiaControls } = require('../src/views/ClientUIAnimationEditor/giaImporter.ts');
    const { createControlProperties } = require('../src/views/ClientUIAnimationEditor/controlRegistry.ts');
    const { imageFeatherPreview } = require('../src/views/ClientUIAnimationEditor/imageFeatherPreview.ts');
    const clone = value => JSON.parse(JSON.stringify(value));
    const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
    const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const maskOf = raw => list(raw['19']['1']['505']).find(c => '84' in c)?.['503']?.['85'];
    function node(type, id, parentId = null, extra = {}) {
      return { id, parentId, name: id, type, active: true, visible: true, locked: false, canControllerFocus: false,
        x: 800, y: 450, width: 200, height: 100, scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 0,
        anchorMinX: .5, anchorMinY: .5, anchorMaxX: .5, anchorMaxY: .5, pivotX: .5, pivotY: .5,
        anchorOffsetX: 0, anchorOffsetY: 0, sizeDeltaX: 200, sizeDeltaY: 100, properties: createControlProperties(type), ...extra };
    }
    function nodesFrom(imported) {
      return imported.controls.map(control => {
        const l = control.layout;
        return node(control.type, `gia_node_${control.sourceNodeIndex}`, control.parentSourceNodeIndex === null ? null : `gia_node_${control.parentSourceNodeIndex}`, {
          name: control.name, visible: control.visible, active: l.active, scaleX: l.scaleX, scaleY: l.scaleY, scaleZ: l.scaleZ,
          rotationX: l.rotationX, rotationY: l.rotationY, rotation: l.rotationZ,
          anchorMinX: l.anchorMinX, anchorMinY: l.anchorMinY, anchorMaxX: l.anchorMaxX, anchorMaxY: l.anchorMaxY,
          pivotX: l.pivotX, pivotY: l.pivotY, anchorOffsetX: l.anchoredPositionX, anchorOffsetY: l.anchoredPositionY, sizeDeltaX: l.sizeDeltaX, sizeDeltaY: l.sizeDeltaY,
          properties: { ...createControlProperties(control.type), ...control.properties },
        });
      });
    }
    const mappings = [
      ['enableMask', '501', [[false, 0], [true, 1]]], ['enableSoftEdge', '509', [[false, 0], [true, 1]]],
      ['softEdgeMode', '510', [['percentage', 0], ['pixel', 1]]], ['reverseMaskArea', '516', [[false, 0], [true, 1]]],
      ['enableFill', '514', [[false, 0], [true, 1]]], ['fillClockwise', '505', [[false, 0], [true, 1]]],
      ['fillType', '515', [['unused', 0], ['horizontal', 1], ['vertical', 2], ['radial90', 3], ['radial180', 4], ['radial360', 5]]],
      ['fillHorizontalType', '503', [['left', 0], ['right', 1]]], ['fillVerticalType', '504', [['bottom', 0], ['top', 1]]],
      ['fillRadial90Type', '506', [['bottomLeft', 0], ['topLeft', 1], ['topRight', 2], ['bottomRight', 3]]],
      ['fillRadialType', '507', [['bottom', 0], ['left', 1], ['top', 2], ['right', 3]]],
      ['horizontalSoftRange', '512', [[0, 0], [75.25, 75.25], [100, 100]]], ['verticalSoftRange', '513', [[0, 0], [88.75, 88.75], [100, 100]]],
    ];
    let cases = 0;
    for (const assetKind of ['containerUI', 'controlTemplate']) {
      for (const [key, field, entries] of mappings) for (const [value, code] of entries) {
        const nodes = [node('container', 'root'), node('image', 'image', 'root')]; nodes[1].properties[key] = value;
        const result = exportGiaUI({ name: 'field-test', uiIndex: 1, assetKind, nodes, deviceIndex: 0 });
        const decoded = converter.decode(result.bytes, { type: 'gia' });
        assert.equal(maskOf(list(decoded.json['2'])[assetKind === 'containerUI' ? 1 : 0])[field] ?? 0, code, `${assetKind} ${key}: actual binary field`);
        assert.equal(importGiaControls(buffer(result.bytes)).controls[1].properties[key], value, `${assetKind} ${key}: reimported value`);
        cases++;
      }
    }
    console.log(`PASS ${cases} binary field cases: feather modes/ranges, reverse, independent fill flag, shapes, directions, origins and clockwise flag`);

    const files = process.argv.slice(2);
    for (const filename of files) {
      const bytes = fs.readFileSync(filename), imported = importGiaControls(buffer(bytes));
      const images = imported.controls.filter(c => c.type === 'image'), name = path.basename(filename, '.gia');
      if (name === '羽化') {
        assert.equal(images.length, 2);
        for (const image of images) {
          const p = image.properties;
          assert.equal(p.enableSoftEdge, true); assert.equal(p.enableFill, false);
          assert.equal(p.softEdgeMode, image.name.startsWith('像素') ? 'pixel' : 'percentage');
          assert.equal(p.softEdgeWidthX, 8); assert.equal(p.softEdgeWidthY, 8);
          assert.equal(p.horizontalSoftRange, 85); assert.equal(p.verticalSoftRange, 85);
          assert.equal(p.fillType, 'horizontal', 'the dormant fill shape is retained with its independent flag off');
          assert.ok(imageFeatherPreview(p, 200, 100).maskImage);
        }
      } else if (name === '反转') {
        assert.equal(images.length, 1); assert.equal(images[0].properties.reverseMaskArea, true);
        assert.equal(images[0].properties.enableSoftEdge, false); assert.equal(images[0].properties.enableFill, false);
      } else if (name === '填充方式') {
        assert.equal(images.length, 19);
        for (const image of images) {
          const p = image.properties, parts = image.name.split('，');
          assert.equal(p.enableFill, true); assert.equal(p.enableSoftEdge, false);
          const expectedType = { '360度': 'radial360', '180度': 'radial180', '90度': 'radial90', '横向': 'horizontal', '纵向': 'vertical' }[parts[0]];
          assert.equal(p.fillType, expectedType, image.name);
          if (parts[0].endsWith('度')) {
            assert.equal(p.fillClockwise, parts[1] === '顺时针', image.name);
            assert.equal(p.fillAmount, .69);
            assert.equal(expectedType === 'radial90' ? p.fillRadial90Type : p.fillRadialType,
              { '左下':'bottomLeft', '左上':'topLeft', '右上':'topRight', '右下':'bottomRight', '上':'top', '下':'bottom', '左':'left', '右':'right' }[parts[2]], image.name);
          } else if (expectedType === 'horizontal') {
            assert.equal(p.fillHorizontalType, parts[1] === '从左至右' ? 'left' : 'right');
            assert.equal(p.fillAmount, parts[1] === '从左至右' ? .63 : .68);
          } else {
            assert.equal(p.fillVerticalType, parts[1] === '从下至上' ? 'bottom' : 'top', image.name);
            assert.equal(p.fillAmount, image.name.endsWith('32') ? .32 : .69);
          }
        }
      }
      const baseline = nodesFrom(imported), source = { document: imported.sourceDocument, baseline, deviceIndex: 0 }, sourceBefore = clone(source);
      for (const assetKind of ['containerUI', 'controlTemplate']) {
        const output = exportGiaUI({ name: imported.projectName, uiIndex: 7, assetKind, nodes: baseline, source, deviceIndex: 0 });
        for (let device = 0; device < 4; device++) {
          const before = importGiaControls(buffer(bytes), device).controls, after = importGiaControls(buffer(output.bytes), device).controls;
          assert.deepEqual(after.map(c => [c.name, c.type, c.layout, c.properties]), before.map(c => [c.name, c.type, c.layout, c.properties]));
        }
        const changed = clone(baseline);
        changed.filter(n => n.type === 'image').forEach(n => Object.assign(n.properties, {
          enableSoftEdge: !n.properties.enableSoftEdge, softEdgeMode: n.properties.softEdgeMode === 'pixel' ? 'percentage' : 'pixel',
          reverseMaskArea: !n.properties.reverseMaskArea, enableFill: !n.properties.enableFill, fillType: 'radial180', fillClockwise: !n.properties.fillClockwise,
          fillHorizontalType: 'right', fillVerticalType: 'bottom', fillRadial90Type: 'topRight', fillRadialType: 'left',
          fillAmount: .33, softEdgeWidthX: 12.25, softEdgeWidthY: 8.5, horizontalSoftRange: 75.25, verticalSoftRange: 88.75,
        }));
        const edited = exportGiaUI({ name: imported.projectName, uiIndex: 8, assetKind, nodes: changed, source, deviceIndex: 0 });
        const after = importGiaControls(buffer(edited.bytes)).controls.filter(c => c.type === 'image');
        const expected = changed.filter(n => n.type === 'image');
        for (let i = 0; i < after.length; i++) {
          for (const key of [...mappings.map(m => m[0]), 'fillAmount', 'softEdgeWidthX', 'softEdgeWidthY']) assert.equal(after[i].properties[key], expected[i].properties[key], `${expected[i].name} changed ${key}`);
        }
        const rawBefore = [...list(source.document.json['1']), ...list(source.document.json['2'])].filter(raw => maskOf(raw));
        const rawAfter = [...list(edited.document.json['1']), ...list(edited.document.json['2'])].filter(raw => maskOf(raw));
        assert.deepEqual(rawAfter.map(raw => maskOf(raw)['502']), rawBefore.map(raw => maskOf(raw)['502']), 'unmapped native flag 502 is preserved');
      }
      assert.deepEqual(source, sourceBefore, 'round trips do not mutate the original source');
      console.log(`PASS ${path.basename(filename)}: ${images.length} named images, both export formats, four device layouts and edited advanced fields`);
    }
    if (!files.length) console.log('SKIP named native fixtures (pass the three original GIA paths to enable).');
  } finally { Module._load = oldLoad; if (oldTs) Module._extensions['.ts'] = oldTs; else delete Module._extensions['.ts']; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
