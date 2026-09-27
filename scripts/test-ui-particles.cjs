/* Run: node scripts/test-ui-particles.cjs
 * Requires Python with lupa.lua53 (PYTHON_BIN may select the interpreter).
 * Executes the actual exported Lua, including UI factory/cleanup mocks.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, filename);
try {
  const dir = path.resolve(__dirname, "../src/views/UIVfxEditor");
  const { createEmitter, createPreset, parseProject, copyProject } = require(path.join(dir, "particleModel.ts"));
  const { sampleEmitter, bezierPoint, evaluateCurve } = require(path.join(dir, "particleSimulation.ts"));
  const { LUA_RUNTIME_SOURCE } = require(path.join(dir, "particleLuaRuntime.ts"));
  const { buildParticleLua, toLua } = require(path.join(dir, "particleLuaExporter.ts"));
  let count = 0;
  function test(name, fn) { fn(); console.log("PASS " + name); count++; }
  const e = { ...createEmitter(), delay: .5, duration: 1, rate: 4, burst: 2, maxParticles: 512,
    lifetime: { min: 30, max: 30 }, shape: "point", speed: { min: 10, max: 10 }, angle: 0, spread: 0, gravity: { x: 0, y: 0 } };
  test("Delay, burst and continuous emission have one owner at loop boundaries", () => {
    for (const [time, expected] of [[.49,0],[.5,3],[.75,4],[1.499999,6],[1.5,9],[1.75,10]]) assert.equal(sampleEmitter(e,time).length, expected);
    assert.equal(sampleEmitter({ ...e, loop: false },1.5).length,6);
    assert.equal(sampleEmitter({ ...e, burst: 0, rate: 0 },100).length,0);
    assert.equal(sampleEmitter({ ...e, delay:0, duration:.1, rate:.5, burst:0 },3).length,2);
    assert.equal(sampleEmitter({ ...e, delay:0, duration:1, rate:4, burst:0 },2).length,9);
    assert.equal(sampleEmitter({ ...e, loop:false },32).length,0);
  });
  test("Analytic velocity, Bezier endpoints and piecewise curves", () => {
    assert.equal(sampleEmitter(e,1)[0].x,5);
    const p0={x:2,y:3},p1={x:4,y:10},p2={x:8,y:20},p3={x:12,y:30};
    assert.deepEqual(bezierPoint(0,p0,p1,p2,p3),p0);
    assert.deepEqual(bezierPoint(1,p0,p1,p2,p3),p3);
    assert.equal(evaluateCurve([{t:0,value:0},{t:.5,value:2},{t:1,value:0}],.25),1);
    const seek=sampleEmitter(e,2.12); sampleEmitter(e,100); assert.deepEqual(sampleEmitter(e,2.12),seek);
  });
  test("A full ring pool replaces oldest slots without reviving them", () => {
    const result = sampleEmitter({...e,maxParticles:3},1.5);
    assert.deepEqual(result.map(p=>p.ordinal),[6,7,8]);
    assert.equal(new Set(result.map(p=>p.slot)).size,3);
    const short={...e,maxParticles:2,lifetime:{min:.05,max:.05}};
    assert.equal(sampleEmitter(short,1.7).length,0);
  });
  const project=createPreset("coins",100002);
  test("Engineering JSON validates ranges, finite numbers, IDs and total budgets", () => {
    assert.deepEqual(parseProject(JSON.parse(JSON.stringify(project))),project);
    for(const mutate of [
      p=>p.emitters[0].rate=Infinity,
      p=>p.emitters[0].lifetime={min:2,max:1},
      p=>p.emitters[0].seed=1.5,
      p=>p.emitters[0].imageId=-1,
      p=>p.emitters[0].alphaCurve=[{t:0,value:1},{t:0,value:0}],
      p=>p.emitters.push({...p.emitters[0]}),
      p=>{p.emitters=[0,1,2].map(i=>({...p.emitters[0],id:"unique"+i,maxParticles:512}));},
    ]) { const bad=copyProject(project); mutate(bad); assert.throws(()=>parseProject(bad)); }
  });
  test("Lua export refuses incomplete resources and invalid creation indices", () => {
    assert.throws(()=>buildParticleLua(createPreset("stars")));
    assert.throws(()=>buildParticleLua(project,{templateIndex:1.2}));
    const disabled=copyProject(project); disabled.emitters[0].enabled=false;
    assert.throws(()=>buildParticleLua(disabled));
    assert.match(buildParticleLua(project),/IMAGE_CONTROL_TEMPLATE_INDEX = nil/);
    assert.match(buildParticleLua(project,{templateIndex:7}),/IMAGE_CONTROL_TEMPLATE_INDEX = 7/);
  });
  const cases=[];
  for (const preset of ["stars","snow","coins"]) {
    for (const shape of ["point","circle","ring","box"]) {
      const emitter=createPreset(preset,100002).emitters[0];
      emitter.shape=shape; emitter.seed=2147483646; emitter.delay=.13; emitter.maxParticles=17;
      for (const time of [0,.13,.1301,.25,.999,1,1.999999,2,2.13,2.130001,5.13,6.13,12,31,101.875,120]) {
        cases.push({emitter:toLua(emitter),time,expected:sampleEmitter(emitter,time)});
      }
    }
  }
  for(const emitter of [{...e,imageId:100002},{...e,imageId:100002,loop:false},{...e,imageId:100002,rate:0,burst:6},{...e,imageId:100002,rate:.7,burst:0,duration:3.7}]) {
    for(const time of [.5,.75,1.5,2.5,3,4.2,8.9,60]) cases.push({emitter:toLua(emitter),time,expected:sampleEmitter(emitter,time)});
  }
  project.emitters[0].maxParticles=5;
  const tricky='中文 "quote" \\ path\nnewline\r\t\0'+'123';
  project.name=tricky;
  const payload={ runtime:LUA_RUNTIME_SOURCE,cases,project:toLua(project),
    host:buildParticleLua(project,{templateIndex:7}),levelHost:buildParticleLua(project,{templateIndex:7,levelTime:true}),
    unconfigured:buildParticleLua(project),text:toLua(tricky),expectedText:tricky };
  const result=spawnSync(process.env.PYTHON_BIN || "python",[path.join(__dirname,"test-ui-particles-lua.py")],{
    input:JSON.stringify(payload),encoding:"utf8",maxBuffer:4*1024*1024,env:{...process.env,PYTHONIOENCODING:"utf-8"},
  });
  if(result.stdout) process.stdout.write(result.stdout);
  if(result.stderr) process.stderr.write(result.stderr);
  if(result.error) throw result.error;
  assert.equal(result.status,0,"Lua 5.3 execution/parity failed; install lupa or set PYTHON_BIN.");
  console.log("PASS "+count+" JS groups and "+cases.length+" JS/Lua parity samples");
} finally { if(previous) Module._extensions[".ts"]=previous; else delete Module._extensions[".ts"]; }


