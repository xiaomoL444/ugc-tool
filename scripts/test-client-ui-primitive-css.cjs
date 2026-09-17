const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, file);
try {
  const { exportPrimitiveCss: write, importPrimitiveCss: read } = require('../src/views/ClientUIAnimationEditor/primitiveCss.ts');
  const { normalizePrimitiveData } = require('../src/views/ClientUIAnimationEditor/primitiveData.ts');
  const element = (type, x, y, width, height, rotation, rgb) => ({type,imageId:0,x,y,width,height,rotation,color:{r:rgb[0],g:rgb[1],b:rgb[2],a:.95}});
  const fit = {version:1,width:300,height:300,elements:[
    element('ellipse',0,0,176,176,0,[15,118,110]),
    element('rectangle',0,10,108,108,0,[251,191,36]),
    element('rectangle',0,-76,124,26,0,[17,94,89]),
    element('triangle',-68,88,46,42,-18,[124,58,237]),
    element('rectangle',76,80,42,42,15,[56,189,248]),
  ]};
  const before = JSON.stringify(fit), css = write(fit);
  assert.equal(JSON.stringify(fit),before,'export must not mutate saved data');
  assert.ok(css.startsWith('/* Miliastra CSS Export */\n.shaper-container {\n  position: relative;\n  width: 300px;\n  height: 300px;\n  background: #ffffff;\n  overflow: hidden;\n}'));
  const blocks = [...css.matchAll(/\.shaper-element\.shaper-e(\d+) \{\n([^}]+)\}/g)];
  assert.equal(blocks.length,5);
  assert.equal(blocks[0][2], '  left: 150.00px;\n  top: 150.00px;\n  width: 176.00px;\n  height: 176.00px;\n  background: #0f766e;\n  opacity: 0.9500;\n  transform: translate(-50%, -50%) rotate(-0.00deg);\n  transform-origin: 50% 50%;\n  z-index: 0;\n  border-radius: 50%;\n');
  blocks.forEach(([_,index,body],i) => {
    assert.equal(Number(index),i); assert.ok(body.includes(`z-index: ${i};`));
    assert.equal(body.includes('border-radius'),i===0); assert.equal(body.includes('clip-path'),i===3);
  });
  assert.match(blocks[1][2],/top: 140.00px/); assert.match(blocks[2][2],/top: 226.00px/);
  assert.match(blocks[3][2],/left: 82.00px;\n  top: 62.00px/);
  assert.match(blocks[3][2],/rotate\(18.00deg\)/);
  assert.match(blocks[3][2],/clip-path: polygon\(50% 0%, 0% 100%, 100% 100%\);/);
  assert.match(blocks[4][2],/rotate\(-15.00deg\)/);
  const fractional = {...fit,width:1560.43,height:959.53,elements:[{...fit.elements[0],x:10.12345,y:-8.6789,rotation:23.45678,color:{r:0,g:1,b:15,a:.123456}}]};
  const rounded = write(fractional);
  assert.match(rounded,/width: 1560.43px/); assert.match(rounded,/left: 790.34px/); assert.match(rounded,/top: 488.44px/);
  assert.match(rounded,/background: #00010f/); assert.match(rounded,/opacity: 0.1235/); assert.match(rounded,/rotate\(-23.46deg\)/);
  for (const alpha of [0,1]) assert.ok(write({...fit,elements:[{...fit.elements[0],color:{r:0,g:0,b:0,a:alpha}}]}).includes(`opacity: ${alpha.toFixed(4)};`));
  assert.throws(()=>write({...fit,elements:[]}),/有效/);
  assert.throws(()=>write({...fit,elements:[{...fit.elements[0],x:Infinity}]}),/有效/);
  assert.throws(()=>write({...fit,elements:[{...fit.elements[0],width:.0001}]}),/过小/);
  const plain = css.replace('background: #ffffff;', 'background: transparent;');
  const parsed = read(plain);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)),normalizePrimitiveData(fit),'transparent container roundtrips all shapes');
  const white = read(css);
  assert.equal(white.elements.length,6,'white CSS background becomes a bottom rectangle');
  assert.deepEqual(white.elements[0],{type:'rectangle',imageId:100001,x:0,y:0,width:300,height:300,rotation:0,color:{r:255,g:255,b:255,a:1}});
  assert.equal(read(write(white)).elements.length,6,'repeated imports do not accumulate opaque backgrounds');
  const resized = read(plain,{width:600,height:300});
  assert.deepEqual(resized.elements,parsed.elements,'contain scale centres the 300x300 CSS in a wider canvas');
  const doubled = read(plain,{width:600,height:600});
  assert.equal(doubled.elements[3].x,-136); assert.equal(doubled.elements[3].y,176); assert.equal(doubled.elements[3].width,92);
  assert.equal(doubled.elements[3].rotation,-18);
  const rgba = read(plain.replace('background: #0f766e;', 'background: rgba(15,118,110,0.5);'));
  assert.equal(rgba.elements[0].color.a,.475,'fill alpha multiplies opacity');
  const bgAlpha = read(css.replace('background: #ffffff;','background: rgba(255,255,255,0.2);'));
  assert.equal(bgAlpha.elements[0].color.a,.2);
  const reordered = read(plain.replace('z-index: 0;', 'z-index: 99;'));
  assert.equal(reordered.elements[4].type,'ellipse','z-index controls order, not CSS rule order');
  const rules = plain.match(/\.shaper-element\.shaper-e\d+ \{[^}]+\}/g);
  const reversedRules = plain.slice(0,plain.indexOf('.shaper-element.shaper-e0'))+rules.reverse().join('\n');
  assert.deepEqual(read(reversedRules.replace(/z-index: \d+;/g,'z-index: 0;')),parsed,'equal z-index uses numeric class order');
  assert.equal(read(rounded).elements[1].color.a,.1235,'fractional CSS remains importable');
  assert.equal(JSON.stringify(fit),before);
  for (const bad of [
    css+' @import "https://example.com/x.css";', css+' .other {color:red;}',
    css.replace('background: #0f766e;', 'background: url(https://example.com/x.png);'),
    css.replace('background: #0f766e;', 'background: linear-gradient(red,blue);'),
    css.replace('left: 150.00px;', 'left: calc(50% + 2px);'),
    css.replace('left: 150.00px;', 'left: 50%;'),
    css.replace('opacity: 0.9500;', 'opacity: 2;'),
    css.replace('z-index: 0;', 'z-index: -1;'),
    css.replace('z-index: 0;', 'z-index: 0.5;'),
    css.replace('border-radius: 50%;','border-radius: 25%;'),
    css.replace('width: 176.00px;','width: 0px;'),
    css.replace('50% 50%;','0% 0%;'), css.replace('rotate(-0.00deg)','scale(2)'),
    css.replace('opacity: 0.9500;', 'filter: blur(2px);'),
    css.replace('opacity: 0.9500;', 'opacity: 0.5; opacity: 1;'),
    css.replace('0% 100%, 100% 100%','0% 50%, 100% 100%'),
    css.replace('.shaper-element.shaper-e1','.shaper-element.shaper-e0'),
    css+'}', '', '/* unterminated', css.replace('width: 300px;', 'width: 40000px;'),
    `@media screen {${css}}`, css.replace('opacity: 0.9500;','opacity: 0.5 !important;'),
  ]) assert.throws(()=>read(bad),Error,bad.slice(-120));
  assert.throws(()=>read(css,{width:0,height:100}),/尺寸/);
  assert.throws(()=>read(' '.repeat(2*1024*1024+1)),/2 MiB/);
  const many = {...fit,elements:Array.from({length:1001},()=>fit.elements[0])};
  assert.throws(()=>read(write(many)),/1001/,'container background counts toward element budget');
  assert.equal(read(write(many).replace('background: #ffffff;','background: transparent;')).elements.length,1001);
  console.log('PASS primitive CSS: format, import/export roundtrip, background, fit, stacking, alpha, security, limits, immutable data');
} finally { Module._extensions['.ts'] = previous; }
