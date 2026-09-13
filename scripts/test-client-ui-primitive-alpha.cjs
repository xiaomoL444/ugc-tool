const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,file);
const {preparePrimitivePixels}=require('../src/views/ClientUIAnimationEditor/primitivePixels.ts');
Module._extensions['.ts']=previous;
const source=Uint8ClampedArray.from([255,255,255,0, 200,100,50,128, 9,19,29,255]);
const saved=source.slice();
assert.deepEqual([...preparePrimitivePixels(source,true).rgba],[0,0,0,0,100,50,25,128,9,19,29,255]);
assert.deepEqual([...preparePrimitivePixels(source,false).rgba],[255,255,255,255,227,177,152,255,9,19,29,255]);
assert.deepEqual(source,saved);
assert.equal(preparePrimitivePixels(new Uint8ClampedArray(4),true).visible,false);
console.log('PASS premultiplied transparent input, partial alpha, opaque white compositing and unchanged original pixels');
function contains(s,x,y){
  const a=s.angle*Math.PI/180,dx=x-s.cx,dy=y-s.cy,u=dx*Math.cos(a)+dy*Math.sin(a),v=-dx*Math.sin(a)+dy*Math.cos(a);
  return s.type==='circle'?u*u/(s.rx*s.rx)+v*v/(s.ry*s.ry)<=1:Math.abs(u)<=s.hw&&Math.abs(v)<=s.hh;
}
async function main(){
  require('../public/primitive-wasm/wasm_exec.js');
  const go=new Go(),{instance}=await WebAssembly.instantiate(fs.readFileSync(path.join(__dirname,'../public/primitive-wasm/primitive.wasm')),go.importObject);go.run(instance);
  const width=48,height=64,pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const d=(x-24)**2/100+(y-32)**2/784,i=(y*width+x)*4;
    if(d<=1){pixels[i]=d<.8?244:82;pixels[i+1]=d<.8?237:47;pixels[i+2]=d<.8?190:54;pixels[i+3]=255;}
  }
  const {rgba,alpha}=preparePrimitivePixels(pixels,true);
  const init=JSON.parse(primitiveFitInit(JSON.stringify({full_w:width,full_h:height,work_w:width,work_h:height,num_primitives:40,allowed_shapes:['circle','rect'],transparent:true,mask_threshold:127}),rgba,alpha));
  assert.equal(init.ok,true);let state=primitiveFitState();
  // A hostile/off-canvas candidate must be rejected at apply, not just search.
  primitiveFitApply(JSON.stringify({type:'circle',x:24,y:32,rx:200,ry:200,angle:0,alpha:255,energy:0}));
  state=primitiveFitState();
  for(let i=0;i<init.steps.length;i++){
    const candidate=JSON.parse(primitiveFitSearch(null,state.score,init.steps[i],2,i));
    assert.ok(Number.isFinite(candidate.energy));
    const next=primitiveFitApply(JSON.stringify(candidate));assert.equal(next.error,undefined);assert.ok(next.score<=state.score+1e-8);state=next;
  }
  const result=JSON.parse(primitiveFitFinish());assert.ok(result.shapes.length>5);
  let outside=0,inside=0;
  for(const s of result.shapes){assert.ok(s.alpha>0&&s.alpha<=1);assert.ok(s.type==='circle'||s.type==='rect');}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let a=0;for(const s of result.shapes)if(contains(s,x+.5,y+.5))a=s.alpha+a*(1-s.alpha);
    if(alpha[y*width+x])inside+=a;else outside+=a;
  }
  assert.ok(inside>300,'foreground must remain visible');
  assert.ok(outside<inside*.02,`exported geometry leaked too much alpha: ${outside}/${inside}`);
  console.log(`PASS native WASM: ${result.shapes.length} shapes, monotonic score, rejected off-canvas shape, outside/inside alpha ${(outside/inside*100).toFixed(3)}%`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
