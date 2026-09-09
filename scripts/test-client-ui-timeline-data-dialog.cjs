/* Run: node scripts/test-client-ui-timeline-data-dialog.cjs
 * Runs the dialog's actual setup code with Vue reactivity and deferred File.text().
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const vue = require("vue");
const { parse } = require("@vue/compiler-sfc");

const filename = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor/TimelineDataImportDialog.vue");
const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
assert.deepEqual(parsed.errors, []);
assert.ok(parsed.descriptor.scriptSetup, "The dialog must provide its actual setup script");
const ast = ts.createSourceFile(filename + ".ts", parsed.descriptor.scriptSetup.content,
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const setup = ast.statements.filter((statement) => !ts.isImportDeclaration(statement))
  .map((statement) => statement.getText(ast)).join("\n");
const script = ts.transpileModule(`${setup}\nglobalThis.api = {
  readFile, updateSource, confirm, close, readingFile, fileError, canConfirm
};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const fixtures = [];
function fixture() {
  const props = vue.reactive({ sourceText: "existing Data", rootId: "root",
    roots: [{ id: "root", label: "Root" }], mode: "append",
    preview: { schema: "ClientUIAnimationEditor.TweenTimeline@7", importedCount: 2,
      replacedCount: 1, duration: 3, errors: [], warnings: [] } });
  const events = [];
  const unmountCallbacks = [];
  const scope = vue.effectScope();
  const context = vm.createContext({ ...vue,
    defineProps: () => props,
    defineEmits: () => (event, ...args) => {
      events.push([event, ...args]);
      if (event === "update:sourceText") props.sourceText = args[0];
    },
    onMounted: () => {},
    onBeforeUnmount: (callback) => unmountCallbacks.push(callback),
  });
  scope.run(() => vm.runInContext(script, context, { filename, timeout: 2000 }));
  let disposed = false;
  const result = { props, api: context.api, events,
    sources: () => events.filter(([event]) => event === "update:sourceText").map(([, source]) => source),
    confirms: () => events.filter(([event]) => event === "confirm").length,
    dispose() {
      if (disposed) return;
      disposed = true;
      unmountCallbacks.forEach((callback) => callback());
      scope.stop();
    },
  };
  fixtures.push(result);
  return result;
}

function selectFile(dialog, text, overrides = {}) {
  const target = { value: "chosen-file", files: [{ name: "Timeline.lua", size: 20,
    text: typeof text === "function" ? text : () => text, ...overrides }] };
  const read = dialog.api.readFile({ target });
  assert.equal(target.value, "", "Reset the input so the same file can be selected again");
  return read;
}

let passed = 0;
async function test(name, check) {
  try { await check(); passed++; console.log(`PASS ${name}`); }
  finally { fixtures.splice(0).forEach((dialog) => dialog.dispose()); }
}

async function main() {
  await test("Valid Lua/text files emit source only after reading; busy state blocks confirmation", async () => {
    for (const name of ["Timeline.lua", "Timeline.txt"]) {
      const dialog = fixture();
      const file = deferred();
      const read = selectFile(dialog, file.promise, { name });
      assert.equal(dialog.api.readingFile.value, true);
      dialog.api.confirm();
      assert.equal(dialog.confirms(), 0);
      assert.deepEqual(dialog.sources(), []);
      file.resolve("new Data source");
      await read;
      assert.deepEqual(dialog.sources(), ["new Data source"]);
      assert.equal(dialog.api.fileError.value, "");
      assert.equal(dialog.api.readingFile.value, false);
      assert.equal(dialog.api.canConfirm.value, true);
      dialog.api.confirm();
      dialog.api.confirm();
      assert.equal(dialog.confirms(), 1, "Duplicate submit events in the same tick are ignored");
    }
  });

  await test("Oversized, unsupported and unreadable files show errors and block old-preview confirmation", async () => {
    const cases = [
      { options: { size: 2 * 1024 * 1024 + 1 }, read: () => assert.fail("Oversized files must not be read"), error: /2 MiB/ },
      { options: { name: "Timeline.json" }, read: () => assert.fail("Unsupported files must not be read"), error: /\.lua.*\.txt/ },
      { options: {}, read: () => Promise.reject(new Error("Read failed")), error: /无法读取/ },
    ];
    for (const item of cases) {
      const dialog = fixture();
      await selectFile(dialog, item.read, item.options);
      assert.match(dialog.api.fileError.value, item.error);
      assert.equal(dialog.api.readingFile.value, false);
      assert.equal(dialog.api.canConfirm.value, false);
      dialog.api.confirm();
      assert.equal(dialog.confirms(), 0);
      assert.deepEqual(dialog.sources(), []);
    }
  });

  await test("Consecutive file selections accept only the newest result in either completion order", async () => {
    for (const newestFirst of [true, false]) {
      const dialog = fixture();
      const oldFile = deferred();
      const newFile = deferred();
      const oldRead = selectFile(dialog, oldFile.promise);
      const newRead = selectFile(dialog, newFile.promise);
      if (newestFirst) {
        newFile.resolve("newest Data");
        await newRead;
        oldFile.resolve("outdated Data");
        await oldRead;
      } else {
        oldFile.resolve("outdated Data");
        await oldRead;
        assert.equal(dialog.api.readingFile.value, true, "An old completion cannot clear the new read's busy state");
        assert.deepEqual(dialog.sources(), []);
        newFile.resolve("newest Data");
        await newRead;
      }
      assert.deepEqual(dialog.sources(), ["newest Data"]);
      assert.equal(dialog.api.readingFile.value, false);
    }
  });

  await test("Manual edits and parent source changes invalidate outstanding file reads", async () => {
    for (const parentChange of [false, true]) {
      const dialog = fixture();
      const file = deferred();
      const read = selectFile(dialog, file.promise);
      if (parentChange) dialog.props.sourceText = "parent Data";
      else dialog.api.updateSource({ target: { value: "typed Data" } });
      assert.equal(dialog.api.readingFile.value, false);
      file.resolve("outdated file Data");
      await read;
      assert.equal(dialog.props.sourceText, parentChange ? "parent Data" : "typed Data");
      assert.deepEqual(dialog.sources(), parentChange ? [] : ["typed Data"]);
    }
  });

  await test("Closing or unmounting discards both late file results and late read errors", async () => {
    for (const action of ["close", "unmount"]) {
      for (const fails of [false, true]) {
        const dialog = fixture();
        const file = deferred();
        const read = selectFile(dialog, file.promise);
        if (action === "close") dialog.api.close();
        else dialog.dispose();
        if (fails) file.reject(new Error("Late failure"));
        else file.resolve("late Data");
        await read;
        assert.deepEqual(dialog.sources(), []);
        assert.equal(dialog.api.fileError.value, "");
        assert.equal(dialog.api.readingFile.value, false);
        assert.equal(dialog.events.filter(([event]) => event === "close").length, action === "close" ? 1 : 0);
      }
    }
  });

  await test("Missing previews, validation errors and zero clips never confirm in append or replace mode", () => {
    for (const mode of ["append", "replace"]) {
      const dialog = fixture();
      dialog.props.mode = mode;
      const validPreview = { ...dialog.props.preview };
      for (const preview of [null, { ...validPreview, errors: ["Invalid path"] }, { ...validPreview, importedCount: 0 }]) {
        dialog.props.preview = preview;
        assert.equal(dialog.api.canConfirm.value, false);
        dialog.api.confirm();
      }
      assert.equal(dialog.confirms(), 0);
      dialog.props.preview = { ...validPreview, warnings: ["An informational warning"] };
      assert.equal(dialog.api.canConfirm.value, true);
      dialog.api.confirm();
      assert.equal(dialog.confirms(), 1);
    }
  });
  console.log(`${passed} Timeline Data dialog regressions passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
