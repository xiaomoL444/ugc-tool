const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, file);
try {
  const { buildPrimitiveProjectLua } = require('../src/views/ClientUIAnimationEditor/primitiveLuaExporter.ts');
  const { buildPrimitiveImageLibLua } = require('../src/views/ClientUIAnimationEditor/primitiveLuaRuntime.ts');
  const { parseLuaData } = require('../src/views/ClientUIAnimationEditor/luaDataParser.ts');
  const node = (id, type, parentId = null, extra = {}) => ({ id, name: id, type, parentId, width: 300, height: 300, properties: {}, ...extra });
  const nodes = [node('root', 'container', null, { name: '导出根"容器' }), node('group', 'container', 'root', { name: '头部' }),
    node('hair', 'primitive', 'group', { name: '中"刘海', properties: { imageResourceId: 'hair' }, rotation: 90, scaleX: -1, visible: false, canControllerFocus: true }),
    node('copy', 'primitive', 'root', { width: 100, height: 50, properties: { imageResourceId: 'hair' } }),
    node('missing', 'primitive', 'root'), node('outside', 'primitive', null, { properties: { imageResourceId: 'hair' } })];
  const fitData = { version: 1, width: 200, height: 100, elements: ['ellipse', 'rectangle', 'triangle'].map((type, i) => ({
    type, imageId: 0, x: 20, y: -10, width: 40, height: 20, rotation: -30,
    color: { r: 12, g: 34, b: 56, a: [0.5, 0, 1][i] },
  })) };
  const resources = [{ id: 'hair', name: '图片', imageUrl: 'data:image/png;base64,TEST', fitData }];
  const options = { projectName: '测试项目', rootNodeId: 'root', nodes, resources };
  const original = JSON.stringify(options);
  const result = buildPrimitiveProjectLua(options), data = parseLuaData(result.code);
  assert.equal(result.targetCount, 2); assert.equal(result.elementCount, 6); assert.equal(result.warnings.length, 1);
  assert.equal(data.groups[0].path, '头部/中"刘海');
  assert.equal(data.groups[1].path, 'copy');
  assert.equal(data.v, 3);
  assert.equal(data.groups[0].visible, false); assert.equal(data.groups[0].focus, true);
  assert.equal(data.groups[1].visible, undefined); assert.equal(data.groups[1].focus, undefined);
  assert.equal(data.columns, undefined); assert.equal(data.rootName, undefined); assert.equal(data.schema, undefined);
  assert.equal(data.groups[0].controlSize, undefined);
  assert.deepEqual(data.groups[0].elements[0], [1, 0, 30, -15, 60, 30, -30, 12, 34, 56, 128]);
  assert.deepEqual(data.groups[0].elements.map(row => row[0]), [1, 0, 2]);
  assert.doesNotMatch(result.code, /100001|100002|100003|"Basic"|"Stretch"/);
  assert.deepEqual(data.groups[0].elements.map(row => row[10]), [128, 0, 255]);
  assert.equal(data.groups[1].elements[0][2], 10, 'shared images must use each target control size');
  assert.equal(JSON.stringify(options), original, 'export never mutates document');
  assert.equal(parseLuaData(buildPrimitiveProjectLua({ ...options, rootNodeId: 'group' }).code).groups[0].path, '中"刘海');
  const selfResult = buildPrimitiveProjectLua({ ...options, rootNodeId: 'hair' });
  const selfData = parseLuaData(selfResult.code);
  assert.equal(selfResult.targetCount, 1);
  assert.equal(selfData.groups[0].path, '', 'selected primitive exports itself as root');
  assert.deepEqual(selfData.groups[0].elements, data.groups[0].elements);
  const nestedNodes = [...nodes, node('nested', 'primitive', 'hair', { properties: { imageResourceId: 'hair' } })];
  assert.deepEqual(parseLuaData(buildPrimitiveProjectLua({ ...options, rootNodeId: 'hair', nodes: nestedNodes }).code).groups.map(group => group.path), ['', 'nested']);
  const nonContainerNodes = nodes.map(item => item.id === 'group' ? { ...item, type: 'image' } : item);
  assert.equal(parseLuaData(buildPrimitiveProjectLua({ ...options, rootNodeId: 'group', nodes: nonContainerNodes }).code).groups[0].path, '中"刘海');
  assert.throws(() => buildPrimitiveProjectLua({ ...options, rootNodeId: 'unknown' }), /选择一个控件/);
  assert.throws(() => buildPrimitiveProjectLua({ ...options, rootNodeId: 'missing' }), /没有可导出/);
  assert.equal(JSON.stringify(options), original, 'selected-root exports never mutate document');
  assert.throws(() => buildPrimitiveProjectLua({ ...options, resources: [] }), /没有可导出/);
  const duplicate = [...nodes, node('duplicate', 'container', 'root', { name: '头部' })];
  assert.throws(() => buildPrimitiveProjectLua({ ...options, nodes: duplicate }), /同级重名/);
  assert.throws(() => buildPrimitiveProjectLua({ ...options, nodes: nodes.map(n => n.id === 'hair' ? { ...n, name: 'bad/path' } : n) }), /不能用于路径/);
  assert.throws(() => buildPrimitiveProjectLua({ ...options, nodes: nodes.map(n => n.id === 'hair' ? { ...n, width: 0 } : n) }), /尺寸/);
  assert.throws(() => buildPrimitiveProjectLua({ ...options, resources: [{ ...resources[0], fitData: { ...fitData, elements: [] } }] }), /有效的图元/);
  console.log('PASS scoped paths, ambiguity, shared-image sizing, rotation, image IDs, byte alpha, hidden targets, missing results and immutable exports');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ugc-primitive-lua-'));
  fs.writeFileSync(path.join(directory, 'lib.lua'), buildPrimitiveImageLibLua().code);
  fs.writeFileSync(path.join(directory, 'data.lua'), result.code);
  fs.writeFileSync(path.join(directory, 'self.lua'), selfResult.code);
  const legacy = { schema: 'UGCTools.PrimitiveProject@1', columns: ['imageId','imageType','x','y','width','height','rotation','r','g','b','a'], groups: data.groups.map(group => ({ ...group, elements: group.elements.map(row => [100001 + row[0], 'Basic', ...row.slice(2)]) })) };
  const lua = value => typeof value === 'string' ? JSON.stringify(value) : Array.isArray(value) ? `{${value.map(lua).join(',')}}` : value && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${key}=${lua(item)}`).join(',')}}` : String(value);
  fs.writeFileSync(path.join(directory, 'legacy.lua'), `return ${lua(legacy)}`);
  fs.writeFileSync(path.join(directory, 'v2.lua'), `return ${lua({ v: 2, groups: data.groups.map(({ visible, focus, ...group }) => group) })}`);
  const harness = fs.readFileSync(path.join(__dirname, 'fixtures/primitive-runtime.lua'), 'utf8');
  fs.writeFileSync(path.join(directory, 'test.lua'), `local lib = dofile('lib.lua')\nlocal data = dofile('data.lua')\n${harness}`);
  const large = buildPrimitiveProjectLua({ ...options, resources: [{ ...resources[0], fitData: { ...fitData, elements: Array.from({ length: 400 }, (_, i) => fitData.elements[i % 3]) } }] });
  fs.writeFileSync(path.join(directory, 'large.lua'), large.code);
  if (process.env.LUA_BIN) {
    const run = spawnSync(process.env.LUA_BIN, ['test.lua'], { cwd: directory, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr); process.stdout.write(run.stdout);
  } else if (process.env.PYTHON_BIN && process.env.LUPA_PATH) {
    const source = 'import sys; sys.path.insert(0, sys.argv[1]); from lupa.lua53 import LuaRuntime; runtime = LuaRuntime(); runtime.execute(open("test.lua", encoding="utf-8").read())';
    const run = spawnSync(process.env.PYTHON_BIN, ['-c', source, process.env.LUPA_PATH], { cwd: directory, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr); process.stdout.write(run.stdout);
  } else console.log('SKIP Lua execution: set LUA_BIN, or PYTHON_BIN and LUPA_PATH to use Lua 5.3.');
} finally { Module._extensions['.ts'] = previous; }
