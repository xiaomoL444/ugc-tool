const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, file);
async function main() {
  const { convertPsdDocument, validatePsdHeader } = require('../src/views/ClientUIAnimationEditor/psdImportData.ts');
  const { migratePrimitiveResources } = require('../src/views/ClientUIAnimationEditor/primitiveResources.ts');
  const solid = (width,height,r=255) => ({width,height,data:Uint8ClampedArray.from(Array.from({length:width*height},()=>[r,0,0,255]).flat())});
  const raster = new Map(); let serial=0;
  const encode = async (data,width,height) => { const url=`data:image/png;base64,TEST${++serial}`; raster.set(url,{data,width,height}); return url; };
  const doc = {width:100,height:80,children:[
    {name:'底层',left:0,top:0,imageData:solid(100,80)},
    {name:'文件夹',children:[
      {name:'隐藏图片',left:20,top:15,hidden:true,imageData:solid(4,6)},
      {name:'子文件夹',children:[{name:'顶层',left:30,top:25,imageData:solid(2,3),opacity:.5}]},
      {name:'空文件夹',children:[]},
    ]},
    {name:'空图层',left:10,top:10},
  ]};
  const result = await convertPsdDocument(doc,'嵌套测试',encode);
  assert.equal(result.folders,3); assert.equal(result.layers,4); assert.equal(result.hidden,1);
  assert.equal(result.nodes.length,8);
  assert.deepEqual(result.nodes.filter(n=>n.parentId===result.nodes[0].id).map(n=>n.name),['空图层','文件夹','底层'],'editor hierarchy is top-first');
  const group=result.nodes.find(n=>n.name==='文件夹'), childGroup=result.nodes.find(n=>n.name==='子文件夹'), leaf=result.nodes.find(n=>n.name==='顶层');
  assert.equal(group.type,'container'); assert.equal(childGroup.parentId,group.id); assert.equal(leaf.parentId,childGroup.id);
  assert.deepEqual([group.x,group.y,group.width,group.height],[26,58.5,12,13]);
  assert.deepEqual([leaf.x,leaf.y,leaf.width,leaf.height],[1,1.5,2,3]);
  const hidden=result.nodes.find(n=>n.name==='隐藏图片'); assert.equal(hidden.visible,false);
  const leafAsset=result.resources.find(r=>r.id===leaf.properties.imageResourceId);
  assert.equal(raster.get(leafAsset.imageUrl).data[3],128,'layer opacity is baked into the resource');
  assert.equal(leaf.properties.imageUrl,''); assert.equal(leaf.properties.previewMode,'image'); assert.equal(leafAsset.fitData,null);
  const saved=JSON.parse(JSON.stringify(result)); const restored=migratePrimitiveResources(saved.nodes,saved.resources);
  assert.equal(restored.resources.length,4); assert.equal(restored.nodes.find(n=>n.name==='顶层').properties.imageResourceId,leafAsset.id);
  assert.equal(result.nodes[0].anchorMaxX,1); assert.equal(result.nodes[0].sizeDeltaX,0);
  const maskDoc={width:8,height:8,children:[{name:'蒙版',left:2,top:3,imageData:solid(2,1),mask:{left:2,top:3,defaultColor:0,imageData:solid(1,1,128)}}]};
  const masked=await convertPsdDocument(maskDoc,'蒙版',encode);
  const mp=raster.get(masked.resources[0].imageUrl).data; assert.deepEqual([mp[3],mp[7]],[128,0]);
  await assert.rejects(convertPsdDocument({width:2,height:2,children:[]},'空',encode),/没有可导入/);
  await assert.rejects(convertPsdDocument({width:2,height:2,children:[{imageData:{width:2,height:2,data:new Uint8Array(4)}}]},'坏',encode),/像素数据无效/);
  const header=new ArrayBuffer(26),v=new DataView(header); v.setUint32(0,0x38425053); v.setUint16(4,1); v.setUint32(14,80); v.setUint32(18,100); v.setUint16(22,8); v.setUint16(24,3);
  validatePsdHeader(header); v.setUint16(22,16); assert.throws(()=>validatePsdHeader(header),/8 位/); assert.throws(()=>validatePsdHeader(new ArrayBuffer(1)),/不完整/);
  console.log('PASS nested folders, top-first tree, local positions, hidden/empty layers, resource links, opacity, raster masks, persistence and malformed files');
  if (process.argv[2]) {
    const ag=require('ag-psd'); ag.initializeCanvas(()=>{throw Error('Unexpected canvas');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
    const bytes=fs.readFileSync(process.argv[2]); validatePsdHeader(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const psd=ag.readPsd(bytes,{useImageData:true,skipCompositeImageData:true,skipThumbnail:true,skipLinkedFilesData:true});
    const actual=await convertPsdDocument(psd,'真实 PSD',encode);
    assert.equal(actual.layers,actual.resources.length); assert.equal(actual.nodes.length,1+actual.folders+actual.layers);
    assert.ok(actual.resources.every(r=>raster.get(r.imageUrl).data.length===raster.get(r.imageUrl).width*raster.get(r.imageUrl).height*4));
    console.log(`PASS supplied PSD: ${actual.width}x${actual.height}, ${actual.layers} layers, ${actual.folders} folders, ${actual.hidden} hidden, ${actual.warnings.length} warnings`);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{Module._extensions['.ts']=previous;});
