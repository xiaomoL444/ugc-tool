const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {parse, compileScript, compileTemplate} = require('@vue/compiler-sfc');
require.extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const dir = path.resolve(__dirname,'../src/views/ClientUIAnimationEditor');
const {controlRegistry} = require(path.join(dir,'controlRegistry.ts'));
const {imageMaskFields} = require(path.join(dir,'imageMaskFields.ts'));
const {imageFeatherPreview,imageFillMask} = require(path.join(dir,'imageFeatherPreview.ts'));
for(const fillType of ['horizontal','vertical','radial90','radial180','radial360']) {
  assert.equal(imageFillMask({fillType,fillAmount:0}),'linear-gradient(transparent, transparent)');
  assert.equal(imageFillMask({fillType,fillAmount:1}),'linear-gradient(#000, #000)');
  assert.equal(imageFillMask({fillType,fillAmount:-5}),'linear-gradient(transparent, transparent)');
  assert.equal(imageFillMask({fillType,fillAmount:5}),'linear-gradient(#000, #000)');
}
assert.match(imageFillMask({fillType:'horizontal',fillHorizontalType:'right',fillAmount:0.25}),/to left, #000 25%, transparent 25%/);
assert.match(imageFillMask({fillType:'vertical',fillVerticalType:'top',fillAmount:0.5}),/to bottom, #000 50%/);
for(const origin of ['bottomLeft','topLeft','topRight','bottomRight']) assert.match(imageFillMask({fillType:'radial90',fillRadial90Type:origin,fillAmount:0.5}),/45deg/);
for(const origin of ['bottom','left','top','right']) {
  assert.match(imageFillMask({fillType:'radial180',fillRadialType:origin,fillAmount:0.5}),/90deg/);
  assert.match(imageFillMask({fillType:'radial360',fillRadialType:origin,fillAmount:0.5}),/180deg/);
}
const combined=imageFeatherPreview({enableMask:true,enableSoftEdge:true,reverseMaskArea:true,fillType:'radial360',fillAmount:0.25},100,100);
assert.equal(combined.maskComposite,'subtract, intersect, intersect');
assert.match(combined.maskImage,/conic-gradient/);
assert.deepEqual(imageFeatherPreview({enableMask:false,fillType:'horizontal',fillAmount:0.5},100,100),{});
assert.match(imageFeatherPreview({enableMask:true,enableSoftEdge:false,fillType:'horizontal',fillAmount:0.5},100,100).maskImage,/#000 50%/);
assert.equal(controlRegistry.image.createProperties().softEdgeMode,'pixel');
for (const field of controlRegistry.image.fields.filter(field=>field.kind==='select' && (field.key==='softEdgeMode' || field.key.startsWith('fill')))) {
  assert.equal(controlRegistry.image.createProperties()[field.key],field.options[0].value);
}
assert.ok(imageMaskFields(controlRegistry.image.fields,{enableMask:true,enableSoftEdge:true,softEdgeMode:null}).some(f=>f.key==='softEdgeWidthX'));
const pixel = {enableMask:true,enableSoftEdge:true,softEdgeMode:'pixel',softEdgeWidthY:0};
assert.match(imageFeatherPreview({...pixel,softEdgeWidthX:100},100,100).maskImage,/rgba\(0,0,0,0.5\)/);
assert.match(imageFeatherPreview({...pixel,softEdgeWidthX:1000},100,100).maskImage,/rgba\(0,0,0,0.05\)/);
assert.notEqual(imageFeatherPreview({...pixel,softEdgeWidthX:50},100,100).maskImage,imageFeatherPreview({...pixel,softEdgeWidthX:100},100,100).maskImage);
for (const key of ['horizontalSoftRange','verticalSoftRange']) {
  const field=controlRegistry.image.fields.find(f=>f.key===key); assert.equal(field.min,0); assert.equal(field.max,100);
}
const feather={enableMask:true,enableSoftEdge:true,softEdgeMode:'percentage',horizontalSoftRange:80,verticalSoftRange:100};
assert.deepEqual(imageFeatherPreview({...feather,enableMask:false},200,100),{});
assert.deepEqual(imageFeatherPreview({...feather,enableSoftEdge:false},200,100),{});
assert.match(imageFeatherPreview(feather,200,100).maskImage,/#000 10%/);
assert.match(imageFeatherPreview({...feather,horizontalSoftRange:-213},200,100).maskImage,/#000 50%/);
assert.match(imageFeatherPreview({...feather,softEdgeMode:'pixel',softEdgeWidthX:8,softEdgeWidthY:8},200,100).maskImage,/#000 4%/);
assert.equal(imageFeatherPreview({...feather,reverseMaskArea:true},200,100).maskComposite,'subtract, intersect');
assert.equal(feather.horizontalSoftRange,80);
const values = {...controlRegistry.image.createProperties(), enableSoftEdge:true,softEdgeMode:'pixel',fillType:'radial90',softEdgeWidthX:8,fillAmount:0.85};
const keys = () => imageMaskFields(controlRegistry.image.fields,values).map(f=>f.key);
assert.deepEqual(keys(),['enableMask']);
values.enableMask = true;
assert.ok(keys().includes('softEdgeWidthX')); assert.ok(!keys().includes('horizontalSoftRange'));
assert.ok(keys().includes('fillRadial90Type')); assert.ok(!keys().includes('fillRadialType'));
values.softEdgeMode = 'percentage';
assert.ok(keys().includes('horizontalSoftRange')); assert.ok(!keys().includes('softEdgeWidthX'));
for(const [shape,direction] of [['horizontal','fillHorizontalType'],['vertical','fillVerticalType'],['radial90','fillRadial90Type'],['radial180','fillRadialType'],['radial360','fillRadialType']]) {
  values.fillType = shape;
  assert.deepEqual(keys().filter(k=>['fillHorizontalType','fillVerticalType','fillRadial90Type','fillRadialType'].includes(k)),[direction]);
}
values.fillType='unused'; values.enableSoftEdge=false;
assert.deepEqual(keys(),['enableMask','enableSoftEdge','__fillEnabled','reverseMaskArea']);
values.enableMask=false;
const saved=JSON.stringify(values); keys(); assert.equal(JSON.stringify(values),saved);
assert.equal(values.softEdgeWidthX,8); assert.equal(values.fillAmount,0.85);
const filename=path.join(dir,'ControlPropertiesInspector.vue');
const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'),{filename}); assert.deepEqual(errors,[]);
const script=compileScript(descriptor,{id:'mask-test'});
assert.deepEqual(compileTemplate({source:descriptor.template.content,filename,id:'mask-test',compilerOptions:{bindingMetadata:script.bindings}}).errors,[]);
console.log('PASS mask dependencies, both feather modes, five fill shapes, hidden value preservation and component compilation');
