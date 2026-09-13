const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, file);
try {
  const { convertPrimitiveFit, normalizePrimitiveData, normalizePrimitiveProperties, normalizePrimitiveOptions, primitiveWorkerLimit, buildPrimitiveParameters, buildPrimitiveResourceParameters } = require('../src/views/ClientUIAnimationEditor/primitiveData.ts');
  const { migratePrimitiveResources, normalizePrimitiveResources } = require('../src/views/ClientUIAnimationEditor/primitiveResources.ts');
  const { createControlProperties } = require('../src/views/ClientUIAnimationEditor/controlRegistry.ts');
  const { capturePropertyGroup, pastePropertyGroup, resetPropertyGroup } = require('../src/views/ClientUIAnimationEditor/propertyGroupActions.ts');
  const { describeHistoryChange } = require('../src/views/ClientUIAnimationEditor/historyChangeLabel.ts');
  const result = { shapes: [
    { type: 'circle', cx: 60, cy: 30, rx: 10, ry: 5, angle: 30, color: '#cc8844', alpha: .5 },
    { type: 'rect', cx: 80, cy: 40, hw: 12, hh: 6, angle: -45, color: '#112233', alpha: 1 },
    { type: 'triangle', cx: 100, cy: 50, width: 30, height: 20, angle: 90, color: '#ffffff', alpha: .25 },
  ] };
  const fit = convertPrimitiveFit(result, 200, 100, true);
  assert.equal(fit.elements.length, 4);
  assert.deepEqual(fit.elements[0], { type: 'rectangle', imageId: 100001, x: 0, y: 0, width: 200, height: 100, rotation: 0, color: {r:255,g:255,b:255,a:1} });
  assert.deepEqual(fit.elements[1], { type: 'ellipse', imageId: 100002, x: -40, y: 20, width: 20, height: 10, rotation: -30, color: {r:204,g:136,b:68,a:.5} });
  assert.equal(fit.elements[2].width, 24); assert.equal(fit.elements[2].rotation, 45);
  const original = JSON.stringify(fit);
  const parameters = buildPrimitiveParameters(fit, '图元', 300, 300);
  assert.deepEqual(parameters.elements[1].position, { x: -60, y: 30, z: 0 });
  assert.deepEqual(parameters.elements[1].size, { width: 30, height: 15 });
  assert.deepEqual(parameters.elements.map(e => e.layer), [0,1,2,3]);
  assert.deepEqual(parameters.elements.map(e => e.imageId), [100001,100002,100001,100003]);
  const resourceParameters = buildPrimitiveResourceParameters(fit,'资源');
  assert.equal(resourceParameters.coordinateSystem.origin,'image-center');
  assert.equal(resourceParameters.coordinateSystem.sizeUnit,'pixel');
  assert.equal(resourceParameters.controlSize,undefined);
  assert.deepEqual(resourceParameters.elements[1].position,{x:-40,y:20,z:0});
  assert.equal(JSON.stringify(fit), original, 'export must never change saved fit data');
  assert.equal(convertPrimitiveFit(result,200,100,false).elements.length,3,'transparent output has no white rectangle');
  assert.equal(normalizePrimitiveData({ ...fit, width: 0 }), null);
  assert.equal(normalizePrimitiveData({ ...fit, elements: [{ ...fit.elements[0], rotation: Infinity }] }), null);
  assert.throws(() => convertPrimitiveFit({ shapes: [{...result.shapes[0], rx:NaN}] },200,100,false), /无效/);
  assert.throws(() => buildPrimitiveParameters(fit,'x',0,100), /尺寸/);
  assert.equal(normalizePrimitiveOptions({ count: Infinity, resolution: 10000, workers: 20 }).resolution,512);
  assert.equal(normalizePrimitiveOptions({ workers: 20 }).workers,16);
  assert.deepEqual([1,8,12,32,NaN].map(primitiveWorkerLimit),[1,8,12,16,2]);
  const old = normalizePrimitiveProperties({ imageUrl: 'data:image/png;base64,OLD' });
  assert.equal(old.previewMode,'image'); assert.equal(old.fitData,null);
  const props = normalizePrimitiveProperties(JSON.parse(JSON.stringify({ imageUrl:'data:image/png;base64,EXAMPLE', previewMode:'primitives', fitData:fit })));
  assert.deepEqual(props.fitData,fit); assert.equal(props.previewMode,'primitives');
  const source = { id:'p', name:'Primitive', type:'primitive', properties:props };
  const target = { id:'q', type:'primitive', properties:createControlProperties('primitive') };
  const copied = capturePropertyGroup(source,'control');
  assert.equal(pastePropertyGroup(target,'control',copied),true);
  assert.deepEqual(target.properties.fitData,fit);
  target.properties.fitData.elements[0].width = 1;
  assert.equal(source.properties.fitData.elements[0].width,200,'copied fits must not share mutable arrays');
  assert.equal(resetPropertyGroup(target,'control'),true); assert.equal(target.properties.fitData,undefined);
  const migrated = migratePrimitiveResources([source,{...source,id:'r'}],[]);
  assert.equal(migrated.resources.length,1,'same inline image is migrated to one shared resource');
  assert.equal(migrated.nodes[0].properties.imageResourceId,migrated.nodes[1].properties.imageResourceId);
  assert.equal(migrated.nodes[0].properties.imageUrl,'');
  assert.equal(migrated.nodes[0].properties.fitData,undefined,'control references do not duplicate fitting data');
  const saved = JSON.parse(JSON.stringify(migrated));
  assert.deepEqual(migratePrimitiveResources(saved.nodes,saved.resources),migrated,'resource migration is idempotent across save/reopen');
  assert.equal(migratePrimitiveResources([],migrated.resources).resources.length,1,'unused resources remain in the document');
  assert.equal(normalizePrimitiveResources([migrated.resources[0],migrated.resources[0],null,{}]).length,1);
  assert.match(describeHistoryChange(JSON.stringify({primitiveResources:[]}),JSON.stringify({primitiveResources:migrated.resources})),/导入图片资源/);
  const before = JSON.stringify({nodes:[{...source,properties:createControlProperties('primitive')}]});
  const after = JSON.stringify({nodes:[source]});
  assert.match(describeHistoryChange(before,after),/图元原图/);
  console.log('PASS geometry, Y-up rotation, contain scaling, colors, layer order, background, JSON persistence, legacy defaults, property copy/reset and malformed data');
} finally { Module._extensions['.ts'] = previous; }
