const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const { parse } = Module.createRequire(require.resolve('@vue/compiler-sfc'))('@vue/compiler-dom');
const previous = Module._extensions['.ts'], previousParser = global.DOMParser;
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, file);
// Node has no DOMParser. This AST adapter exercises conversion/validation only;
// actual browser XML parsing and file selection are verified separately in the UI.
global.DOMParser = class {
  parseFromString(source) {
    function element(node) {
      const attrs = node.props.map(p => ({ name: p.name, localName: p.name.split(':').pop(), prefix: p.name.includes(':') ? p.name.split(':')[0] : null, value: p.value?.content ?? '' }));
      return { localName: node.tag, attributes: attrs, children: node.children.filter(n => n.type === 1).map(element),
        getAttribute: name => attrs.find(a => a.name === name)?.value ?? null,
        hasAttribute: name => attrs.some(a => a.name === name) };
    }
    try { return { documentElement: element(parse(source).children.find(n => n.type === 1)), getElementsByTagName: () => [] }; }
    catch { return { getElementsByTagName: () => [{}] }; }
  }
};
try {
  const { importPrimitiveSvg: read, exportPrimitiveSvg: write } = require('../src/views/ClientUIAnimationEditor/primitiveSvg.ts');
  const { normalizePrimitiveResources } = require('../src/views/ClientUIAnimationEditor/primitiveResources.ts');
  const fit = { version: 1, width: 200, height: 100, elements: [
    { type:'rectangle', imageId:100001, x:-40,y:20,width:40,height:20,rotation:35,color:{r:255,g:20,b:40,a:.3} },
    { type:'ellipse', imageId:100002, x:20,y:-20,width:30,height:16,rotation:-60,color:{r:2,g:100,b:200,a:1} },
    { type:'triangle', imageId:100003, x:0,y:0,width:15,height:30,rotation:118,color:{r:255,g:255,b:255,a:0} },
  ] };
  const before = JSON.stringify(fit), svg = write(fit, 'a < b & "test"');
  assert.match(svg, /&lt; b &amp; &quot;test&quot;/);
  assert.doesNotMatch(svg, /<image/);
  assert.doesNotMatch(svg, /translate\(|fill-opacity=|fill="rgb/);
  assert.ok(svg.includes('<rect x="40.00" y="20.00" width="40.00" height="20.00" fill="#ff1428" opacity="0.3000" transform="rotate(-35.00 60.00 30.00)" />'));
  const example = { version:1, width:300, height:300, elements:[{type:'ellipse',imageId:100002,x:0,y:0,width:176,height:176,rotation:0,color:{r:15,g:118,b:110,a:.95}}] };
  assert.ok(write(example,'example').includes('<ellipse cx="150.00" cy="150.00" rx="88.00" ry="88.00" fill="#0f766e" opacity="0.9500" transform="rotate(-0.00 150.00 150.00)" />'));
  assert.deepEqual(JSON.parse(JSON.stringify(read(write(example,'example')))),example);
  const fractional = { ...fit, elements:fit.elements.map(e => ({...e,x:12.34567,y:-9.87654,width:29.33333,height:40.77777,rotation:12.34567,color:{...e.color,a:.956789}})) };
  read(write(fractional,'fractional')).elements.forEach((e,i) => {
    for (const key of ['x','y','width','height','rotation']) assert.ok(Math.abs(e[key]-fractional.elements[i][key])<.02, `rounded ${i}.${key}`);
    assert.equal(e.color.a,.9568);
  });
  const restored = read(svg);
  assert.equal(JSON.stringify(fit), before);
  assert.equal(restored.elements.length, 3);
  restored.elements.forEach((e,i) => {
    const expected = fit.elements[i];
    for (const key of ['x','y','width','height','rotation']) assert.ok(Math.abs(e[key]-expected[key])<1e-8, `${i}.${key}: ${e[key]} != ${expected[key]}`);
    assert.equal(e.imageId,expected.imageId); assert.deepEqual(e.color,expected.color);
  });
  const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50">${body}</svg>`;
  const rect = '<rect x="10" y="20" width="100" height="50" fill="#123456"/>';
  const fitted = read(wrap(rect), {width:200,height:200});
  assert.deepEqual([fitted.elements[0].x,fitted.elements[0].y,fitted.elements[0].width,fitted.elements[0].height], [0,0,200,100]);
  const painted = read(wrap('<g fill="red" fill-opacity="0.5" transform="translate(10 20)"><circle style="fill:blue;opacity:0.4" fill="green" cx="50" cy="25" r="10"/></g>')).elements[0];
  assert.deepEqual(painted.color,{r:0,g:0,b:255,a:.2});
  assert.equal(painted.x,0); assert.equal(painted.y,0);
  assert.equal(read(wrap('<path d="M 50 0 l 20 40 h -40 z"/>')).elements[0].type,'triangle');
  assert.equal(read(wrap('<rect width="20" height="10" transform="matrix(-1 0 0 1 100 0)"/>')).elements[0].width,20);
  for (const unsupported of [
    '<script>alert(1)</script>', '<image href="https://example.com/x.png"/>',
    '<rect width="1" height="1" onload="evil()"/>', '<style>rect{fill:red}</style>',
    '<rect width="1" height="1" fill="url(#g)"/>', '<rect width="1" height="1" stroke="red"/>',
    '<rect width="1" height="1" rx="1"/>', '<rect width="1" height="1" clip-path="url(#c)"/>',
    '<g opacity="0.5">'+rect+'</g>', '<path d="M 0 0 C 1 2 3 4 5 6"/>',
    '<rect width="1" height="1" transform="matrix(1 0 1 1 0 0)"/>',
    '<polygon points="0 0 20 10 11 80"/>', '<rect width="0" height="1"/>',
    '<rect width="1" height="1" style="filter:blur(2px)"/>',
  ]) assert.throws(() => read(wrap(rect+unsupported)), Error, unsupported);
  assert.throws(() => read('<!DOCTYPE svg>'+wrap(rect)), /实体/);
  assert.throws(() => read(wrap(rect.repeat(1002))), /1001/);
  assert.throws(() => read(' '.repeat(2*1024*1024+1)), /2 MiB/);
  assert.throws(() => read(wrap('')), /没有/);
  const asset = {id:'keep-id',name:'Keep',imageUrl:'data:image/png;base64,ORIGINAL',fitData:fit};
  const saved = normalizePrimitiveResources([{...asset,fitData:restored,previewMode:'primitives'}])[0];
  assert.equal(saved.id,asset.id); assert.equal(saved.name,asset.name); assert.equal(saved.imageUrl,asset.imageUrl);
  assert.deepEqual(normalizePrimitiveResources(JSON.parse(JSON.stringify([saved])))[0],saved);
  console.log('PASS primitive SVG: roundtrip, layers, alpha, transforms, fitting, validation, persistence');
} finally { Module._extensions['.ts'] = previous; global.DOMParser = previousParser; }
