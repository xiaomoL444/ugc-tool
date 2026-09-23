/* Run with: node scripts/test-dsfg-walk-talk.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

async function main() {
  const library = await import("miliastra-variable");
  const root = path.resolve(__dirname, "..");
  const directory = path.join(root, "src/views/DSFGStudio/components/WalkTalkEditor");
  const asset = name => require(path.join(root, "src/assets/DSFGStudio/WalkTalk", name));
  const originalLoad = Module._load, originalTs = Module._extensions[".ts"];
  Module._load = function (name, parent, isMain) {
    if (name === "miliastra-variable") return library;
    return originalLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, isMain);
  };
  Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  try {
    const model = require(path.join(directory, "walkTalkProject.ts"));
    const styles = require(path.join(directory, "walkTalkStyles.ts"));
    const { exportWalkTalk, createWalkTalkStructWorkspace } = require(path.join(directory, "walkTalkExporter.ts"));
    const definition = asset("1077936168[消息]边走边说对话.json");
    const sample = asset("NOLOC_测试边走边说变量.json");
    const originalAssets = JSON.stringify([definition, sample]);
    let passed = 0;
    const test = (name, check) => { check(); passed++; console.log(`PASS ${name}`); };
    function source(count = 1) {
      const project = model.createWalkTalkProject();
      for (let i = 0; i < count; i++) model.addWalkTalkEntry(project);
      return project;
    }
    function exported(project) {
      const result = exportWalkTalk(project);
      assert.deepEqual(JSON.parse(result.json), result.value);
      const parsed = createWalkTalkStructWorkspace(project.structIds).parse(result.value);
      assert.deepEqual(parsed.issues, []);
      assert.deepEqual(parsed.toQxqyValue(), result.value);
      return result.value;
    }
    const items = value => value.value[0].value.value.map(item => item.value);

    test("empty sequence uses the actual sample ID, not its filename, without sample dialogue rows", () => {
      const project = source(0), output = exported(project);
      assert.deepEqual(project.structIds, { sequence: "1077936171", dialogue: "1077936168" });
      assert.equal(output.type, "Struct"); assert.equal(output.structId, sample.structId);
      assert.deepEqual(output.value, [{ param_type: "StructList", value: { structId: "1077936168", value: [] } }]);
    });
    test("new dialogue has all six fields and exact source timing defaults", () => {
      const project = source();
      assert.deepEqual(model.WALK_TALK_FIELDS, definition.value.map(field => field.key));
      assert.equal(project.entries[0].continueDelay, "0.00");
      assert.equal(project.entries[0].autoContinue, undefined);
      assert.equal(project.entries[0].params, "");
      assert.equal(project.entries[0].style, "Default");
      const expected = JSON.parse(JSON.stringify(sample.value[0].value.value[0].value));
      expected.value[0].value = "Default";
      assert.deepEqual(items(exported(project))[0], expected);
    });
    test("walk-talk has its own Default option and uses it for append and insert", () => {
      assert.equal(styles.DEFAULT_WALK_TALK_STYLE, "Default");
      assert.deepEqual(styles.WALK_TALK_STYLE_OPTIONS, [{ value: "Default", label: "Default" }]);
      const project = source();
      model.addWalkTalkEntry(project, project.entries[0].id);
      model.addWalkTalkEntry(project);
      assert.ok(project.entries.every(entry => entry.style === "Default"));
      assert.ok(items(exported(project)).every(entry => entry.value[0].value === "Default"));
    });
    test("style save/reload preserves Default and existing legacy values without silently replacing them", () => {
      const project = source(4);
      const values = ["Default", "", "Default_UI", "自定义旧样式"];
      project.entries.forEach((entry, index) => { entry.style = values[index]; });
      const saved = model.encodeWalkTalkProject(project);
      const restored = model.decodeWalkTalkProject(saved);
      assert.deepEqual(restored.entries.map(entry => entry.style), values);
      assert.deepEqual(items(exported(restored)).map(entry => entry.value[0].value), values);
      assert.equal(model.encodeWalkTalkProject(project), saved);
    });
    test("styles, Unicode, multiline text, floats and integer lists populate the ordered fields", () => {
      const project = source();
      Object.assign(project.entries[0], { style: "Default_UI", talker: "派蒙", subtitle: "向导", content: "边走边说\n第二行 ✨", continueDelay: "1.25", params: "0, -1，100;100\n2147483647 -2147483648" });
      const fields = items(exported(project))[0].value;
      assert.deepEqual(fields.map(field => field.param_type), ["String", "String", "String", "String", "Float", "Int32List"]);
      assert.deepEqual(fields.map(field => field.value), ["Default_UI", "派蒙", "向导", "边走边说\n第二行 ✨", "1.25", ["0", "-1", "100", "100", "2147483647", "-2147483648"]]);
    });
    test("insert, move and delete export visible order while keeping stable editor identities", () => {
      const project = source(3);
      const [a, b, c] = project.entries;
      a.content = "A"; b.content = "B"; c.content = "C";
      const d = model.addWalkTalkEntry(project, a.id); d.content = "D";
      assert.deepEqual(project.entries.map(row => row.id), [a.id, d.id, b.id, c.id]);
      model.moveWalkTalkEntry(project, c.id, -1);
      model.removeWalkTalkEntry(project, d.id);
      assert.deepEqual(project.entries.map(row => row.id), [a.id, c.id, b.id]);
      assert.deepEqual(items(exported(project)).map(row => row.value[3].value), ["A", "C", "B"]);
      model.removeWalkTalkEntry(project, a.id); model.removeWalkTalkEntry(project, b.id); model.removeWalkTalkEntry(project, c.id);
      assert.deepEqual(items(exported(project)), []);
    });
    test("out-of-bounds, fractional and missing row operations do not remove other rows", () => {
      const project = source(2), before = model.encodeWalkTalkProject(project);
      model.moveWalkTalkEntry(project, project.entries[0].id, -1);
      model.moveWalkTalkEntry(project, project.entries[1].id, 1);
      model.moveWalkTalkEntry(project, project.entries[0].id, .5);
      model.moveWalkTalkEntry(project, "missing", 1); model.removeWalkTalkEntry(project, "missing");
      assert.equal(model.encodeWalkTalkProject(project), before);
    });
    test("custom IDs propagate to root, list and every dialogue without editor fields leaking", () => {
      const project = source(3); project.structIds = { sequence: "1234567890", dialogue: "1234567891" };
      const output = exported(project);
      assert.equal(output.structId, "1234567890"); assert.equal(output.value[0].value.structId, "1234567891");
      assert.ok(items(output).every(item => item.structId === "1234567891"));
      assert.ok(!JSON.stringify(output).includes("DSFGWalkTalk"));
      assert.ok(!JSON.stringify(output).includes(project.entries[0].id));
    });
    test("each file owns separate rows and ID configuration", () => {
      const a = source(), b = source();
      a.structIds.sequence = "1"; a.entries[0].content = "edited";
      assert.equal(b.structIds.sequence, "1077936171"); assert.equal(b.entries[0].content, "");
      assert.notEqual(a.entries[0].id, b.entries[0].id);
    });
    test("100 dialogue rows export, a 101st cannot be created or imported", () => {
      const project = source(100);
      assert.equal(items(exported(project)).length, 100);
      assert.throws(() => model.addWalkTalkEntry(project), /100/);
      assert.equal(project.entries.length, 100);
      project.entries.push({ ...project.entries[0], id: "overflow" });
      assert.throws(() => exported(project), /100/);
      assert.throws(() => model.decodeWalkTalkProject(JSON.stringify(project)), /100/);
    });
    test("unfinished numeric input survives draft save and reload but blocks variable export", () => {
      const project = source(); Object.assign(project.entries[0], { continueDelay: "-", params: "1, not-finished" });
      const saved = model.encodeWalkTalkProject(project);
      assert.deepEqual(model.decodeWalkTalkProject(saved), project);
      assert.throws(() => exported(project), /continueDelay.*params/);
      assert.equal(model.encodeWalkTalkProject(project), saved);
    });
    for (const field of ["continueDelay"]) {
      test(`${field} rejects blank, nonnumeric and nonfinite values`, () => {
        const project = source();
        for (const text of ["", " ", "NaN", "Infinity", "-Infinity", "1e999", "0x10", "1.2.3", "2s"]) {
          project.entries[0][field] = text;
          assert.throws(() => exported(project), new RegExp(field));
        }
      });
    }
    test("integer parameters reject fractional, out-of-range, partial and over-limit input", () => {
      for (const text of ["1.5", "2147483648", "-2147483649", "NaN", "1e2", "1 two", "0x10", Array(101).fill("0").join(",")]) assert.throws(() => model.parseWalkTalkParams(text));
      assert.equal(model.parseWalkTalkParams(Array(100).fill("0").join(",")).length, 100);
      assert.deepEqual(model.parseWalkTalkParams(""), []);
    });
    test("invalid or duplicate struct IDs cannot replace registry definitions", () => {
      for (const ids of [null, {}, { sequence: "abc", dialogue: "2" }, { sequence: "2", dialogue: "2" }, { sequence: "002", dialogue: "2" }, { sequence: "1", dialogue: 2 }]) {
        assert.ok(model.validateWalkTalkStructIds(ids).length);
        assert.throws(() => createWalkTalkStructWorkspace(ids));
      }
    });
    test("malformed documents and wrong row field types are rejected without coercion", () => {
      for (const value of [null, [], {}, { ...source(), schemaVersion: 9 }, { ...source(), kind: "DSFGQuest" }, { ...source(), entries: null }]) assert.throws(() => model.decodeWalkTalkProject(JSON.stringify(value)));
      assert.throws(() => model.decodeWalkTalkProject("{"), /JSON/);
      const project = source(2); project.entries[1].id = project.entries[0].id;
      assert.throws(() => model.decodeWalkTalkProject(JSON.stringify(project)), /重复/);
      project.entries[1].id = "second"; project.entries[0].continueDelay = 10;
      assert.throws(() => model.decodeWalkTalkProject(JSON.stringify(project)), /continueDelay/);
    });
    test("v1 migration updates default IDs and params, preserving legacy drafts and custom IDs", () => {
      for (const custom of [false, true]) {
        const legacy = { kind: "DSFGWalkTalk", schemaVersion: 1,
          structIds: custom ? { sequence: "900", dialogue: "901" } : { sequence: "1077936168", dialogue: "1077936129" },
          entries: [{ id: "legacy", style: "Default", talker: "派蒙", subtitle: "", content: "旧台词", continueDelay: "0.50", prams: "1, 2", autoContinue: "10.00" }],
        };
        const migrated = model.decodeWalkTalkProject(JSON.stringify(legacy));
        assert.equal(migrated.schemaVersion, 2);
        assert.deepEqual(migrated.structIds, custom ? legacy.structIds : model.DEFAULT_WALK_TALK_STRUCT_IDS);
        assert.equal(migrated.entries[0].params, "1, 2");
        assert.equal(migrated.entries[0].legacyAutoContinue, "10.00");
        assert.equal(migrated.entries[0].prams, undefined);
        assert.equal(migrated.entries[0].autoContinue, undefined);
        assert.deepEqual(model.decodeWalkTalkProject(model.encodeWalkTalkProject(migrated)), migrated);
        const fields = items(exported(migrated))[0].value;
        assert.equal(fields.length, 6);
        assert.deepEqual(fields[5].value, ["1", "2"]);
        assert.ok(!JSON.stringify(exported(migrated)).includes("legacyAutoContinue"));
      }
    });
    test("new wrapper uses the actual datas field and supplied variable shape", () => {
      const project = source(2);
      project.entries.forEach(entry => { entry.style = ""; });
      assert.deepEqual(exported(project), sample);
      const parsed = createWalkTalkStructWorkspace(project.structIds).createDefault(project.structIds.sequence);
      assert.equal(parsed.value.datas.itemCount, 0);
    });
    test("export does not mutate draft data or the checked-in source schemas/sample", () => {
      const project = source(2); project.entries[0].params = "0，+001 2";
      const before = model.encodeWalkTalkProject(project);
      exported(project); exported(project);
      assert.equal(model.encodeWalkTalkProject(project), before);
      assert.equal(JSON.stringify([definition, sample]), originalAssets);
    });
    console.log(`\n${passed} walk-talk model/export tests passed.`);
  } finally {
    Module._load = originalLoad;
    if (originalTs) Module._extensions[".ts"] = originalTs; else delete Module._extensions[".ts"];
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
