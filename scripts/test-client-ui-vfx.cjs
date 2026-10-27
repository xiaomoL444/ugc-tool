/* Run: node scripts/test-client-ui-vfx.cjs [captured OSS data.json]
 * No browser profile, downloads or build outputs are created by this test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, file);

async function main() {
  const dir = path.resolve(__dirname, '../src/views/ClientUIAnimationEditor');
  const { normalizeUIVfxCatalog, isUIVfxEnabled } = require(path.join(dir, 'uiVfxAssets.ts'));
  const raw = { id: '10001001', nameI18nKey: 'uiEffect.title.10001001', scope: 'ui', category: 1, tagList: [3,15],
    path: '/video/10001001.webm', icon: '/icon/10001001.png', width: 182, height: 182, isLoop: true, hasAudio: true, audioPath: ['/audio/10001001.mp3'] };
  const { assets } = normalizeUIVfxCatalog({ data: [raw], tags: [] });
  assert.equal(assets[0].id, 10001001);
  assert.ok(assets[0].url.endsWith('/Public/UIVfx/video/10001001.webm'));
  assert.ok(assets[0].icon.endsWith('/Public/UIVfx/icon/10001001.png'));
  assert.ok(assets[0].audioUrls[0].endsWith('/Public/UIVfx/audio/10001001.mp3'));
  const silent = normalizeUIVfxCatalog({data:[{...raw,hasAudio:false,icon:null}]}).assets[0];
  assert.equal(silent.icon, null); assert.deepEqual(silent.audioUrls, []);
  for (const override of [{id: 'oops'}, {scope: 'other'}, {path: 'javascript:alert(1)'}, {width:0}, {height: Infinity}, {isLoop:'false'}]) {
    assert.throws(() => normalizeUIVfxCatalog({data:[{...raw,...override}]}));
  }
  assert.throws(() => normalizeUIVfxCatalog({data:[raw,raw]}));
  if (process.argv[2]) {
    const catalog = normalizeUIVfxCatalog(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    assert.ok(catalog.assets.some(asset=>asset.scope==='screen') && catalog.assets.some(asset=>asset.scope==='ui'));
    console.log(`PASS captured OSS catalog: ${catalog.assets.length} assets and ${catalog.tags.length} tags`);
  }
  console.log('PASS catalog paths, icons, sound metadata and invalid data handling');
  const root = {id:'root',parentId:null,active:true,visible:true};
  const effect = {id:'vfx',parentId:'root',active:true,visible:true};
  assert.equal(isUIVfxEnabled('vfx',[root,effect]),true);
  for (const key of ['visible','active']) {
    assert.equal(isUIVfxEnabled('vfx',[{...root,[key]:false},effect]),false);
    assert.equal(isUIVfxEnabled('vfx',[root,{...effect,[key]:false}]),false);
  }
  assert.equal(isUIVfxEnabled('missing',[root,effect]),false);
  assert.equal(isUIVfxEnabled('vfx',[{...root,parentId:'vfx'},effect]),false);
  console.log('PASS inherited visibility, activation and cyclic hierarchy handling');

  // Verify the actual renderer's split coordinates and frame/lifecycle scheduling.
  const { attachUIVfxRenderer } = require(path.join(dir, 'uiVfxRenderer.ts'));
  const originalRaf = global.requestAnimationFrame, originalCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {};
  const events = new Map(), frames = new Map(), draws = [], video = {
    readyState:2,videoWidth:2560,videoHeight:720,currentTime:0,paused:false,ended:false,
    addEventListener(name,callback){events.set(name,callback);},removeEventListener(name){events.delete(name);},
    requestVideoFrameCallback(callback){frames.set(1,callback);return 1;},cancelVideoFrameCallback(id){frames.delete(id);},
  };
  const canvas = label => ({width:0,height:0,getContext:()=>({drawImage(...args){draws.push([label,...args.slice(1)]);}})});
  const transmission = canvas('T'), emission = canvas('C'); let ready = 0;
  const renderer = attachUIVfxRenderer(video,transmission,emission,{onFrame(){ready++;},onError(){assert.fail('renderer error');}});
  renderer.draw();
  assert.deepEqual(draws,[['T',1280,0,1280,720,0,0,1280,720],['C',0,0,1280,720,0,0,1280,720]]);
  assert.equal(transmission.width,1280); assert.equal(emission.height,720);
  renderer.draw(); assert.equal(ready,1,'duplicate decoded frames are skipped');
  video.currentTime=1; frames.get(1)(); assert.equal(ready,2);
  video.paused=true; events.get('pause')(); assert.equal(frames.size,0,'pause releases video frame callback');
  renderer.destroy(); assert.equal(events.size,0); renderer.draw(); assert.equal(ready,2);
  global.requestAnimationFrame = originalRaf; global.cancelAnimationFrame = originalCancel;
  console.log('PASS C/T planes, native dimensions, duplicate frames, pause and renderer cleanup');

  // Run the real Vue media setup with fake native media APIs, including its watchers.
  const filename = path.join(dir,'UIVfxMedia.vue');
  const {descriptor,errors} = parse(fs.readFileSync(filename,'utf8'),{filename}); assert.deepEqual(errors,[]);
  const ast = ts.createSourceFile(filename+'.ts',descriptor.scriptSetup.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const code = ast.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>statement.getText(ast)).join('\n');
  const props = vue.reactive({asset:assets[0],enabled:true,sound:true,restartToken:0});
  const mounted=[],unmounted=[],audios=[],documentEvents=new Map(); let destroyed=0;
  class Media {
    constructor(){this.currentTime=0;this.duration=10;this.paused=true;this.ended=false;this.src='';this.error=null;this.plays=0;}
    play(){this.paused=false;this.ended=false;this.plays++;return Promise.resolve();}
    pause(){this.paused=true;}
    load(){}
    removeAttribute(name){if(name==='src')this.src='';}
  }
  const scope=vue.effectScope(), nativeVideo=new Media(); let rendererOptions, randomValue=0, randomCalls=0;
  const randomMath=Object.create(Math); randomMath.random=()=>{randomCalls++;return randomValue;};
  const context=vm.createContext({...vue,defineProps:()=>props,withDefaults:value=>value,
    Math:randomMath,
    onMounted:callback=>mounted.push(callback),onBeforeUnmount:callback=>unmounted.push(callback),
    document:{hidden:false,addEventListener:(name,callback)=>documentEvents.set(name,callback),removeEventListener:name=>documentEvents.delete(name)},
    Audio:class extends Media {constructor(){super();audios.push(this);}},
    attachUIVfxRenderer(_video,_t,_c,options){rendererOptions=options;return{draw(){options.onFrame();},destroy(){destroyed++;}};},
  });
  scope.run(()=>vm.runInContext(ts.transpileModule(code+'\nglobalThis.api={video,transmission,emission,ready,finished,restart,finish,syncAudio};',{
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},
  }).outputText,context));
  const api=context.api; api.video.value=vue.markRaw(nativeVideo); api.transmission.value={}; api.emission.value={};
  mounted.forEach(callback=>callback()); await vue.nextTick();
  assert.equal(nativeVideo.loop,false,'custom looping must receive ended instead of wrapping natively to zero'); assert.equal(nativeVideo.muted,true); assert.equal(nativeVideo.paused,false);
  assert.equal(audios[0].paused,false); assert.equal(audios[0].loop,true);
  rendererOptions.onFrame();
  const initialAudioDraws=randomCalls;
  for (let cycle=0;cycle<3;cycle++) {
    nativeVideo.currentTime=10; nativeVideo.paused=true; nativeVideo.ended=true;
    api.finish(); await vue.nextTick();
    assert.equal(nativeVideo.currentTime,5,'10-second loops restart at five seconds on every ending');
    assert.equal(nativeVideo.paused,false); assert.equal(api.finished.value,false);
    assert.equal(api.ready.value,true,'automatic looping keeps the last decoded frame visible');
    assert.equal(audios[0].currentTime,5,'UI sound follows the midpoint seek');
  }
  assert.equal(randomCalls,initialAudioDraws,'automatic loops keep the selected sound');
  nativeVideo.duration=7.5; nativeVideo.currentTime=7.5; api.finish(); await vue.nextTick();
  assert.equal(nativeVideo.currentTime,3.75,'midpoint uses the actual media duration');
  nativeVideo.duration=10;
  console.log('PASS full opening followed by repeated latter-half loops and UI sound synchronization');
  nativeVideo.currentTime=4; props.enabled=false; await vue.nextTick(); assert.equal(nativeVideo.paused,true); assert.equal(audios[0].paused,true);
  props.enabled=true; await vue.nextTick(); assert.equal(nativeVideo.currentTime,0); assert.equal(nativeVideo.paused,false);
  nativeVideo.currentTime=2; props.restartToken++; await vue.nextTick(); assert.equal(nativeVideo.currentTime,0);
  props.sound=false; await vue.nextTick(); assert.equal(audios[0].paused,true); assert.equal(audios[0].muted,true);
  props.asset={...assets[0],isLoop:false}; await vue.nextTick(); assert.equal(nativeVideo.loop,false);
  rendererOptions.onFrame(); assert.equal(api.ready.value,true);
  api.finish(); assert.equal(api.finished.value,true); assert.equal(audios.at(-1).paused,true);
  api.restart(); await vue.nextTick(); assert.equal(api.finished.value,false);
  context.document.hidden=true; documentEvents.get('visibilitychange')(); assert.equal(nativeVideo.paused,true);
  context.document.hidden=false; documentEvents.get('visibilitychange')(); await vue.nextTick(); assert.equal(nativeVideo.paused,false);
  console.log('PASS looping/one-shot UI media, show/activate replay and sound toggle');

  const beforeAlternatives=audios.length;
  props.sound=true;
  props.asset={...assets[0],id:10001120,isLoop:false,audioUrls:['/take-1.mp3','/take-2.mp3','/take-3.mp3']};
  randomValue=0; await vue.nextTick();
  const randomAudio=audios.at(-1);
  assert.equal(audios.length,beforeAlternatives+1,'a list of alternatives creates only one audio player');
  assert.equal(randomAudio.src,'/take-1.mp3'); assert.equal(randomAudio.paused,false);
  randomValue=.999; api.restart(); await vue.nextTick();
  assert.equal(randomAudio.src,'/take-3.mp3','replay draws again, including the last alternative');
  assert.equal(randomAudio.currentTime,0);
  randomValue=.4; props.restartToken++; await vue.nextTick();
  assert.equal(randomAudio.src,'/take-2.mp3','timeline/show triggers also draw from the list');
  const drawsBeforeSync=randomCalls;
  api.syncAudio(true); api.syncAudio(true);
  assert.equal(randomCalls,drawsBeforeSync,'duplicate media callbacks do not draw another sound');
  assert.equal(randomAudio.src,'/take-2.mp3');
  props.enabled=false; await vue.nextTick(); randomValue=0; props.enabled=true; await vue.nextTick();
  assert.equal(randomAudio.src,'/take-1.mp3','showing/activating UI effects draws a new alternative');
  assert.ok(audios.filter(audio=>audio!==randomAudio).every(audio=>audio.paused),'previous effects cannot overlap the chosen sound');
  console.log('PASS one random alternative per UI trigger, replay, show/activate and duplicate callback handling');

  props.sound=true;
  props.asset={...assets[0],id:10002001,scope:'screen',isLoop:true,audioUrls:['/first.mp3','/second.mp3']};
  randomValue=.999;
  const beforeScreen=audios.length;
  await vue.nextTick();
  const firstScreenAudio=audios.at(-1);
  assert.equal(nativeVideo.loop,false,'fullscreen video uses the same custom midpoint loop');
  assert.equal(audios.length,beforeScreen+1,'fullscreen alternatives also share a single player');
  assert.equal(firstScreenAudio.src,'/second.mp3','fullscreen first showing draws a random alternative');
  assert.ok(firstScreenAudio.loop===false && firstScreenAudio.plays===1 && !firstScreenAudio.paused,'only the chosen sound plays once on first showing');
  firstScreenAudio.currentTime=.6;
  const screenRandomCalls=randomCalls;
  nativeVideo.currentTime=10; api.finish(); await vue.nextTick();
  assert.equal(nativeVideo.currentTime,5,'fullscreen loops also restart at the midpoint');
  api.syncAudio(true); api.syncAudio(true);
  assert.ok(firstScreenAudio.currentTime===.6 && firstScreenAudio.plays===1,'video loop and duplicate play callbacks cannot seek or restart sound');
  firstScreenAudio.paused=true; firstScreenAudio.ended=true;
  api.syncAudio(true); assert.ok(firstScreenAudio.paused && firstScreenAudio.plays===1,'finished sounds stay stopped');
  api.restart(); await vue.nextTick();
  props.restartToken++; await vue.nextTick();
  assert.equal(firstScreenAudio.plays,1,'manual and timeline replay remain silent');
  props.enabled=false; await vue.nextTick(); props.enabled=true; await vue.nextTick();
  assert.equal(firstScreenAudio.plays,1,'showing or activating again does not replay sound');
  context.document.hidden=true; documentEvents.get('visibilitychange')();
  context.document.hidden=false; documentEvents.get('visibilitychange')(); await vue.nextTick(); api.syncAudio(true);
  assert.equal(firstScreenAudio.plays,1,'returning to the browser does not replay sound');
  assert.equal(randomCalls,screenRandomCalls,'silent fullscreen replays do not draw another sound');
  console.log('PASS fullscreen sound plays only on first showing, with silent video loops, replay and subsequent show/activate');

  props.enabled=false; await vue.nextTick();
  props.asset={...assets[0],id:10002002,scope:'screen',isLoop:true}; await vue.nextTick();
  const deferredSound=audios.at(-1); assert.equal(deferredSound.plays,0,'hidden effects do not consume first showing');
  props.enabled=true; await vue.nextTick(); assert.equal(deferredSound.plays,1);
  props.sound=false;
  props.asset={...assets[0],id:10002003,scope:'screen',isLoop:true}; await vue.nextTick();
  const mutedSound=audios.at(-1); assert.equal(mutedSound.plays,0);
  props.sound=true; await vue.nextTick(); api.restart(); await vue.nextTick();
  assert.equal(mutedSound.plays,0,'enabling sound later cannot play a missed first-show sound');
  props.asset={...assets[0],id:10002001,scope:'screen',isLoop:true}; await vue.nextTick();
  assert.equal(audios.at(-1).plays,0,'returning from a different preview to the same fullscreen effect is silent');
  const beforeSilent=audios.length;
  props.asset=silent; await vue.nextTick(); api.restart(); await vue.nextTick();
  assert.equal(audios.length,beforeSilent,'silent effects create no audio player');
  console.log('PASS first actual showing, initially muted fullscreen effects and returning to an already shown asset');
  unmounted.forEach(callback=>callback()); scope.stop();
  assert.equal(nativeVideo.src,''); assert.equal(nativeVideo.paused,true); assert.equal(destroyed,1); assert.equal(documentEvents.size,0);
  assert.ok(audios.every(audio=>audio.paused && !audio.src));
  console.log('PASS background pause and media source cleanup');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  if(previousTs)require.extensions['.ts']=previousTs;else delete require.extensions['.ts'];
});
