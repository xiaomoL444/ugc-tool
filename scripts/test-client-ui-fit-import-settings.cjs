const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true},
}).outputText,file);
const directory = path.resolve(__dirname,'../src/views/ClientUIAnimationEditor');
const { descriptor, errors } = parse(fs.readFileSync(path.join(directory,'PrimitiveImageSettings.vue'),'utf8'));
assert.deepEqual(errors,[]);
const compiled = compileScript(descriptor,{id:'fit-import-test'});
assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'PrimitiveImageSettings.vue',id:'fit-import-test',compilerOptions:{bindingMetadata:compiled.bindings}}).errors,[]);
assert.match(descriptor.template.content,/accept="\.css,text\/css" @change="readFitFile\(\$event, 'CSS'\)"/);
const ast = ts.createSourceFile('settings.ts',descriptor.scriptSetup.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declarations = ast.statements.filter(s=>!ts.isImportDeclaration(s)).map(s=>s.getText(ast)).join('\n');
const code = ts.transpileModule(declarations+'\nglobalThis.api={readFitFile,fitReading,error,status,fitting};',{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const data = require(path.join(directory,'primitiveData.ts'));
const css = require(path.join(directory,'primitiveCss.ts'));
const svg = require(path.join(directory,'primitiveSvg.ts'));
const fit = {version:1,width:300,height:300,elements:[{type:'ellipse',imageId:100002,x:0,y:0,width:100,height:80,rotation:20,color:{r:12,g:34,b:56,a:.5}}]};
const source = css.exportPrimitiveCss(fit);
const event = (text=()=>Promise.resolve(source),size=source.length) => ({target:{files:[{size,text}],value:'chosen.css'}});
function fixture() {
  const props = vue.reactive({name:'Asset',modelValue:{id:'keep',imageUrl:'https://example.com/original.png',fitData:fit,fitOptions:{count:123}}});
  const events=[], unmount=[];
  const context = vm.createContext({...vue,...data,...css,...svg,Error,navigator:{hardwareConcurrency:8},
    defineProps:()=>props, defineEmits:()=>((name,value)=>{events.push([name,value]);if(name==='update:modelValue')props.modelValue=value;}),
    onBeforeUnmount:fn=>unmount.push(fn),imageAssetById:new Map(),imageCatalogLoading:vue.ref(false),loadImageCatalog:()=>Promise.resolve(),
  });
  const scope=vue.effectScope(); scope.run(()=>vm.runInContext(code,context));
  return {props,events,api:context.api,close(){unmount.forEach(fn=>fn());scope.stop();}};
}
async function main() {
  let f=fixture();
  try {
    const input=event(); await f.api.readFitFile(input,'CSS');
    assert.equal(input.target.value,''); assert.equal(f.props.modelValue.id,'keep');
    assert.equal(f.props.modelValue.imageUrl,'https://example.com/original.png'); assert.equal(f.props.modelValue.fitOptions.count,123);
    assert.equal(f.props.modelValue.previewMode,'primitives'); assert.equal(f.props.modelValue.fitData.elements.length,2);
    assert.match(f.api.status.value,/CSS/); assert.ok(f.events.some(([name,v])=>name==='busy'&&v===true)); assert.equal(f.api.fitReading.value,false);
    const saved=f.props.modelValue.fitData;
    await f.api.readFitFile(event(()=>Promise.resolve('invalid CSS')),'CSS');
    assert.equal(f.props.modelValue.fitData,saved); assert.match(f.api.error.value,/保留/);
    await f.api.readFitFile(event(()=>Promise.resolve(source),3*1024*1024),'CSS'); assert.match(f.api.error.value,/2 MiB/);
  } finally {f.close();}
  for (const action of ['replace','unmount']) {
    f=fixture(); let resolve;
    try {
      const pending=f.api.readFitFile(event(()=>new Promise(r=>{resolve=r;})),'CSS');
      assert.equal(f.api.fitReading.value,true);
      let secondRead=false; await f.api.readFitFile(event(()=>{secondRead=true;return Promise.resolve(source); }),'SVG');
      assert.equal(secondRead,false,'CSS and SVG cannot race');
      if(action==='replace')f.props.modelValue={...f.props.modelValue,imageUrl:'replacement'}; else f.close();
      resolve(source); await pending;
      assert.equal(f.events.filter(([name])=>name==='update:modelValue').length,0,'stale import must not overwrite resources');
    } finally {if(action!=='unmount')f.close();}
  }
  console.log('PASS fit import settings: actual SFC compilation, CSS upload, atomic failure, preservation, busy state, unmount and stale-read protection');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{Module._extensions['.ts']=previous;});
