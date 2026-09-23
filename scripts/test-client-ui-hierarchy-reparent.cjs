const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const editor = path.resolve(__dirname,'../src/views/ClientUIAnimationEditor');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const imports=Object.assign({},...['boneCreation','tweenRegistry','keyframeTimeline','editorHistory'].map(name=>require(path.join(editor,name+'.ts'))));
const source=parse(fs.readFileSync(path.join(editor,'ClientUIAnimationEditor.vue'),'utf8')).descriptor.scriptSetup.content;
const ast=ts.createSourceFile('editor.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names=['localMatrix','multiplyMatrix','transformVector','calculateWorldTransforms','roundLayout','clamp01','roundTweenTime',
  'getLayoutParent','getLayoutParentSize','getAnchorReference','rebaseNodeLayout','applyNodeLayout','applyDescendantLayouts','getHierarchyOrder',
  'isDescendant','reparentNode','placeNodeRelative','previewNode','applyPreviewNodeLayout','buildKeyframePreviewNodes','hasAnimatedField',
  'keyframeBase','keyframePreviousValue','writeAnimatedValue','insertKeyframeAtTime','selectKeyframe','seekKeyframeTime','readTweenFieldValue',
  'getRuntimeLayoutValues','normalizeColorRGBA','cloneTweenValue'];
const functions=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text));
assert.equal(functions.length,names.length,'exercise the actual editor functions');
assert.match(source,/reparentNode\(node, target.id, true\)/,'inside drops use current preview');
assert.match(source,/reparentNode\(node, nextParent.id, true\)/,'sibling drops use current preview');
const code=ts.transpileModule(functions.map(s=>s.getText(ast)).join('\n')+`
const rootContainer=computed(()=>nodes.value.find(n=>n.parentId===null));
const worldTransforms=computed(()=>calculateWorldTransforms(nodes.value));
const previewNodes=computed(()=>buildKeyframePreviewNodes(currentTime.value));
const previewNodeMap=computed(()=>new Map(previewNodes.value.map(n=>[n.id,n])));
const previewWorldTransforms=computed(()=>calculateWorldTransforms(previewNodes.value));
globalThis.api={${names.join(',')},worldTransforms,previewWorldTransforms,previewNodes};`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const plain=v=>JSON.parse(JSON.stringify(v));
const node=(id,parentId,extra={})=>({id,parentId,name:id,type:'container',x:150,y:100,width:200,height:100,scaleX:1,scaleY:1,scaleZ:1,rotation:0,rotationX:0,rotationY:0,anchorMinX:.5,anchorMaxX:.5,anchorMinY:.5,anchorMaxY:.5,pivotX:.5,pivotY:.5,anchorOffsetX:0,anchorOffsetY:0,sizeDeltaX:200,sizeDeltaY:100,properties:{text:'keep',imageResourceId:'keep'},...extra});
function fixture(parent={}) {
  const context=vm.createContext({...vue,...imports,createTweenId:()=>`generated-${Math.random()}`,
    nodes:vue.ref([node('root',null,{x:800,y:450,width:1600,height:900}),node('a','root',{x:300,y:300,rotation:30,scaleX:2,scaleY:2}),node('b','root',{x:1000,y:400,pivotX:.1,pivotY:.8,rotation:-20,scaleX:3,scaleY:3,...parent}),
      node('child','a',{type:'image',x:80,y:70,width:80,height:40,rotation:15,scaleX:.8,scaleY:1.2,pivotX:.2,pivotY:.7,anchorMinX:0,anchorMaxX:1,anchorMinY:.1,anchorMaxY:.8}),node('leaf','child',{x:12,y:18,width:10,height:15}),node('sibling','b')]),
    canvasWidth:vue.ref(1600),canvasHeight:vue.ref(900),keyframeTracks:vue.ref([]),tweenTracks:vue.ref([]),currentTime:vue.ref(1),duration:vue.ref(5),playing:vue.ref(false),timelineEditNotice:vue.ref(''),selectedId:vue.ref('child'),selectedKeyframeId:vue.ref(null),selectedTweenTrackId:vue.ref(null),
  });
  vm.runInContext(code,context); context.nodes.value.forEach(context.api.rebaseNodeLayout);
  return Object.assign(context.api,{state:context,child:context.nodes.value.find(n=>n.id==='child'),parent:context.nodes.value.find(n=>n.id==='b')});
}
function samePose(before,after,id) {
  const a=before.get(id),b=after.get(id);
  for(const key of ['x','y'])assert.ok(Math.abs(a[key]-b[key])<.025,`${id} ${key}: ${a[key]} != ${b[key]}`);
  for(const key of ['a','b','c','d'])assert.ok(Math.abs(a.matrix[key]-b.matrix[key])<1e-8,`${id} matrix.${key}`);
}
async function main(){
  for(const parent of [{},{scaleX:-3,scaleY:3},{rotation:0,scaleX:2,scaleY:4}]){
    const f=fixture(parent);
    if(parent.scaleY===4){f.state.nodes.value.find(n=>n.id==='a').rotation=0;f.child.rotation=0;}
    const before=f.previewWorldTransforms.value,child=plain(f.child),leaf=plain(f.state.nodes.value.find(n=>n.id==='leaf'));
    assert.equal(f.reparentNode(f.child,'b',true),true);
    samePose(before,f.previewWorldTransforms.value,'child');samePose(before,f.previewWorldTransforms.value,'leaf');
    for(const key of ['width','height','pivotX','pivotY','anchorMinX','anchorMaxX','anchorMinY','anchorMaxY','properties','scaleZ','rotationX','rotationY'])assert.deepEqual(plain(f.child[key]),child[key],key+' preserved');
    assert.deepEqual(plain(f.state.nodes.value.find(n=>n.id==='leaf')),leaf,'descendant own values unchanged');
    assert.equal(f.reparentNode(f.child,'a',true),true);samePose(before,f.previewWorldTransforms.value,'child');
  }
  const f=fixture(),before=f.previewWorldTransforms.value;
  assert.equal(f.placeNodeRelative(f.child,f.state.nodes.value.find(n=>n.id==='sibling'),'before'),true);
  samePose(before,f.previewWorldTransforms.value,'child');
  assert.equal(f.state.nodes.value.indexOf(f.child)+1,f.state.nodes.value.findIndex(n=>n.id==='sibling'));
  const snapshot=JSON.stringify(f.child);assert.equal(f.placeNodeRelative(f.child,f.state.nodes.value.find(n=>n.id==='sibling'),'after'),true);assert.equal(JSON.stringify(f.child),snapshot,'same-parent reorder does not change attributes');
  assert.equal(f.reparentNode(f.child,null,true),true);samePose(before,f.previewWorldTransforms.value,'child');
  for(const parent of [{scaleX:0},{scaleY:0},{scaleX:2,scaleY:3,rotation:25}]){
    const blocked=fixture(parent),saved=JSON.stringify(blocked.state.nodes.value);
    assert.equal(blocked.reparentNode(blocked.child,'b',true),false);assert.equal(JSON.stringify(blocked.state.nodes.value),saved);assert.match(blocked.state.timelineEditNotice.value,/取消/);
    assert.equal(blocked.placeNodeRelative(blocked.child,blocked.state.nodes.value.find(n=>n.id==='sibling'),'after'),false);assert.equal(JSON.stringify(blocked.state.nodes.value),saved);
  }
  const guards=fixture();
  assert.equal(guards.reparentNode(guards.state.nodes.value[0],'b',true),false);
  assert.equal(guards.reparentNode(guards.child,'leaf',true),false);assert.equal(guards.reparentNode(guards.child,'child',true),false);assert.equal(guards.reparentNode(guards.child,'missing',true),false);
  const animated=fixture();
  const track=(nodeId,fieldKey,value)=>({id:fieldKey+nodeId,nodeId,fieldKey,keyframes:[{id:fieldKey+nodeId,time:0,value,easeType:'Linear',interpolation:'tween'}]});
  animated.state.keyframeTracks.value=[track('b','localRotationZ',-35),track('b','sizeDeltaX',400),track('b','localScaleX',4),track('b','localScaleY',4),track('child','anchoredPositionX',30),track('child','anchoredPositionY',50),track('child','localRotationZ',25),track('child','localScaleX',1.4),track('child','sizeDeltaX',-100)];
  const animationBefore=animated.previewWorldTransforms.value, animationSize=animated.previewNodes.value.find(n=>n.id==='child');
  assert.equal(animated.reparentNode(animated.child,'b',true),true);samePose(animationBefore,animated.previewWorldTransforms.value,'child');samePose(animationBefore,animated.previewWorldTransforms.value,'leaf');
  const animationAfter=animated.previewNodes.value.find(n=>n.id==='child');
  assert.equal(animationAfter.width,animationSize.width);assert.equal(animationAfter.height,animationSize.height);
  assert.ok(animated.state.keyframeTracks.value.filter(t=>t.nodeId==='child').every(t=>t.keyframes.some(k=>k.time===1)),'compensate current frame on existing tracks');
  const historyFixture=fixture(),state=historyFixture.state;
  const history=imports.createEditorHistory({capture:()=>JSON.stringify(state.nodes.value),restore:s=>{state.nodes.value=JSON.parse(s);},describe:()=> '换父级'});
  const old=JSON.stringify(state.nodes.value);history.begin('drag');historyFixture.reparentNode(historyFixture.child,'b',true);history.end('drag');
  const changed=JSON.stringify(state.nodes.value);history.flush();
  await history.undo();assert.equal(JSON.stringify(state.nodes.value),old,'one undo restores hierarchy and properties');
  await history.redo();assert.equal(JSON.stringify(state.nodes.value),changed,'redo restores the compensated transform');history.dispose();
  console.log('PASS hierarchy reparent: rotated/scaled/mirrored parents, subtree, anchors, ordering, detach, invalid transforms, current keyframes and undo');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Module._extensions['.ts']=previous;});
