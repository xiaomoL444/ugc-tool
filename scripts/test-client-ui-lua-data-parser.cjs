/* Run: node scripts/test-client-ui-lua-data-parser.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const originalTsExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  module._compile(compiled.outputText, filename);
};

try {
  const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const { parseLuaData, MAX_LUA_DATA_LENGTH } = require(path.join(editor, "luaDataParser.ts"));
  const { buildTweenTimelineDataLua } = require(path.join(editor, "luaTweenExporter.ts"));
  const { createControlProperties } = require(path.join(editor, "controlRegistry.ts"));
  let passed = 0;
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
  function rejects(source) { assert.throws(() => parseLuaData(source), /第 \d+ 行，第 \d+ 列/); }

  test("All three static module forms preserve the exported schema", () => {
    for (const source of [
      'local TweenTimelineData = {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5}; return TweenTimelineData',
      'local custom_name_2 = {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5} return custom_name_2;',
      'return {schema="ClientUIAnimationEditor.TweenTimeline@7",duration=5};',
      '{schema="ClientUIAnimationEditor.TweenTimeline@7";duration=5;}',
    ]) {
      const result = parseLuaData(source);
      assert.equal(result.schema, "ClientUIAnimationEditor.TweenTimeline@7");
      assert.equal(result.duration, 5);
      assert.equal(Object.getPrototypeOf(result), null);
    }
  });

  test("Exporter output round trips numeric clips, colors, relative flags and Chinese paths", () => {
    const root = { id: "root", name: "根控件", parentId: null, type: "container", properties: createControlProperties("container") };
    const child = { id: "child", name: '中文"路径\\测试', parentId: "root", type: "image", properties: createControlProperties("image") };
    const result = buildTweenTimelineDataLua({ projectName: "解析测试", rootNodeId: "root", nodes: [root, child], sequenceDuration: 5,
      tracks: [
        { id: "size", nodeId: "root", fieldKey: "sizeDeltaX", startTime: 0, duration: 1, easeType: "Linear", initialValue: 0, endValue: 40, relative: true },
        { id: "color", nodeId: "child", fieldKey: "imageColor", startTime: 2, duration: 1, easeType: "Linear", initialValue: { r: 255, g: 0, b: 20, a: 0.5 }, endValue: { r: 10, g: 30, b: 50, a: 1 } },
      ],
    });
    assert.equal(result.trackCount, 2);
    const parsed = parseLuaData(result.code);
    assert.equal(parsed.duration, 5);
    assert.equal(parsed.schema, "ClientUIAnimationEditor.TweenTimeline@7");
    assert.deepEqual(parsed.columns, ["path", "field", "start", "duration", "ease", "from", "to", "relative"]);
    assert.deepEqual(parsed.tracks[0], ["", "sizeDeltaX", 0, 1, "Linear", 0, 40, true]);
    assert.deepEqual(parsed.tracks[1], [child.name, "imageColor", 2, 1, "Linear", [255, 0, 20, 128], [10, 30, 50, 255]]);
  });

  test("nil columns and explicit numeric gaps keep their positions", () => {
    assert.deepEqual(parseLuaData('{nil, false, nil, {255, 128, 0, 255}, nil}'), [null, false, null, [255, 128, 0, 255], null]);
    assert.deepEqual(parseLuaData('{[3]="三",[1]="一"}'), ["一", null, "三"]);
    assert.deepEqual(parseLuaData('{}'), []);
    assert.deepEqual(parseLuaData('{1, [3]=3, 2}'), [1, 2, 3]);
    assert.equal(parseLuaData('{["empty"]=nil}').empty, null);
  });

  test("BOM, comments, long strings, delimiters and numeric literal forms", () => {
    const result = parseLuaData('\uFEFF-- heading\r\n--[==[ long\ncomment ]==]\nreturn { ["中文键"] = [=[\n多行\r\n文本]=]; numbers={-2, .5, 1., -1.25e-2, 2E+3,}; -- trailing\n}');
    assert.equal(result["中文键"], "多行\n文本");
    assert.deepEqual(result.numbers, [-2, 0.5, 1, -0.0125, 2000]);
  });

  test("Lua quoted-string escapes include UTF-8 bytes and unicode code points", () => {
    const result = parseLuaData(String.raw`{"a\n\r\t\a\b\f\v\\\"\'", '\228\184\173\230\150\135', "\xE4\xB8\xAD", "\u{1F680}", "a\z   b", "\0001", "__proto__"}`);
    assert.deepEqual(result, ["a\n\r\t\x07\b\f\v\\\"'", "中文", "中", "🚀", "ab", "\x001", "__proto__"]);
    assert.deepEqual(parseLuaData('{"a\\\r\nb"}'), ["a\nb"]);
  });

  test("Calls, references, statements, expressions and mismatched returns are rejected", () => {
    for (const source of [
      'return require("module")', 'return {require("module")}', 'return {game.value}',
      '{function() end}', '{x = (function() return 1 end)()}', '{x = 1 + 2}', '{x = 1..2}',
      '{x = true and false}', '{x = variable}', '{[1 + 1]=1}', '{[true]=1}',
      'local data = {}; data.x = 1; return data', 'local data = {}; return other',
      'local data = {}; return data; os.execute("echo bad")', '{} return {}',
      'return {}; return {}', 'local a, b = {}, {}; return a', 'local return = {}; return return',
      'local data = {}', '{}()', '{"a" "b"}', '{1,,2}', '{return = 1}',
    ]) rejects(source);
  });

  test("Ambiguous and dangerous keys cannot enter parsed data", () => {
    for (const source of [
      '{x=1, ["x"]=2}', '{[1]=1, 2}', '{1, [1]=2}', '{x=1, 2}',
      '{["1"]=1, [1]=2}', '{__proto__={}}', '{["constructor"]={}}', '{prototype=1}',
      '{[0]=1}', '{[-1]=1}', '{[1.5]=1}', '{[1e20]=1}',
    ]) rejects(source);
    assert.equal(Object.getPrototypeOf(parseLuaData('{["toString"]=1}')), null);
  });

  test("Malformed numbers, strings, comments and unclosed tables include line and column", () => {
    for (const source of ['{1e999}', '{1e}', '{0x10}', '{"unterminated}', '{"a\nb"}',
      '{"\\q"}', '{"\\256"}', '{"\\x0"}', '{"\\u{D800}"}', '{"\\u{110000}"}',
      '{"\\255"}', '{[=[unclosed}', '--[=[unclosed', '{1', '']) rejects(source);
    assert.throws(() => parseLuaData('return {\r\n  value = game\r\n}'), /第 2 行，第 11 列/);
  });

  test("Depth, input size, entry count and total sparse-array slots are bounded", () => {
    assert.equal(MAX_LUA_DATA_LENGTH, 2 * 1024 * 1024);
    assert.doesNotThrow(() => parseLuaData("{".repeat(64) + "}".repeat(64)));
    rejects("{".repeat(65) + "}".repeat(65));
    rejects(" ".repeat(MAX_LUA_DATA_LENGTH + 1));
    rejects("{" + "nil,".repeat(100_001) + "}");
    rejects('{[100001]=1}');
    rejects('{{[60000]=1}, {[60000]=1}}');
    rejects("{" + Array.from({length: 100_001}, (_, index) => `k${index}=nil`).join(",") + "}");
  });

  console.log(`\n${passed} Lua Data parser tests passed.`);
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
