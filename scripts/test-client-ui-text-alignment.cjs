/* Run: node scripts/test-client-ui-text-alignment.cjs [sample.gia ...] [--write-project absolute/path.json]
 * --write-project writes the first sample's unmodified createGiaProject result.
 * Uses the real GIA codec/importer and the editor's Vue setup declarations.
 * Only DOM lifecycle, archive injection and download effects are replaced.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const vue = require("vue");
const { parse } = require("@vue/compiler-sfc");

async function main() {
  const root = path.resolve(__dirname, "..");
  const editor = path.join(root, "src/views/ClientUIAnimationEditor");
  const filename = path.join(editor, "ClientUIAnimationEditor.vue");
  const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(parsed.errors, []);
  const ast = ts.createSourceFile(filename + ".ts", parsed.descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) ||
    (ts.isVariableStatement(statement) && !statement.declarationList.declarations.some((declaration) =>
      declaration.initializer && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === "defineComponent")),
  ).map((statement) => statement.getText(ast)).join("\n");
  const exposed = ["nodes", "makeNode", "textRenderStyle", "createGiaProject", "loadGiaFile", "loadProject", "saveProject", "switchDevice"];
  const script = ts.transpileModule(`${declarations}\nglobalThis.editorApi = { ${exposed.join(", ")} };`, {
    fileName: filename + ".ts",
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const converter = await import("genshin-impact-ugc-file-converter-web");
  const originalLoad = Module._load;
  const originalTsExtension = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) {
    if (request === "genshin-impact-ugc-file-converter-web") return converter;
    return originalLoad.call(this, request, parent, isMain);
  };
  Module._extensions[".ts"] = (module, sourcePath) => {
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
      fileName: sourcePath,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    });
    module._compile(compiled.outputText, sourcePath);
  };
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const arrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let passed = 0;
  async function test(name, check) { await check(); passed += 1; console.log(`PASS ${name}`); }
  try {
    const registry = require(path.join(editor, "controlRegistry.ts"));
    const tweenRegistry = require(path.join(editor, "tweenRegistry.ts"));
    const clipLayout = require(path.join(editor, "timelineClipLayout.ts"));
    const importer = require(path.join(editor, "giaImporter.ts"));
    const controlTemplates = require(path.join(editor, "controlTemplates.ts"));
    Object.assign(controlTemplates, require(path.join(editor, "giaExporter.ts")));
    const directionGuide = require(path.join(editor, "containerDirectionGuide.ts"));
    const editorHistory = require(path.join(editor, "editorHistory.ts"));
    const historyChangeLabel = require(path.join(editor, "historyChangeLabel.ts"));
    const keyframeTimeline = { ...require(path.join(editor, "keyframeTimeline.ts")), ...require(path.join(editor, "animationCollection.ts")) };
    const keyframeLua = require(path.join(editor, "keyframeLua.ts"));
    function createEditor() {
      let savedProject;
      const context = vm.createContext({
        ...vue, ...registry, ...tweenRegistry, ...clipLayout, ...importer, ...controlTemplates, ...directionGuide, ...editorHistory, ...historyChangeLabel, ...keyframeTimeline, ...keyframeLua,
        inject: () => null,
        nextTick: () => Promise.resolve(),
        window: { alert(message) { assert.fail(message); } },
        document: { createElement: () => ({ click() {} }) },
        Blob: class { constructor(parts) { this.text = parts.join(""); } },
        URL: { createObjectURL(blob) { savedProject = JSON.parse(blob.text); return "blob:test"; }, revokeObjectURL() {} },
      });
      vm.runInContext(script, context, { filename, timeout: 2000 });
      return Object.assign(context.editorApi, { getSavedProject: () => savedProject });
    }
    function syntheticGia(texts = [{ sourceNodeIndex: 2, body: {} }], rotations) {
      const textBody = { "501": 20, "503": 12, "504": 4294954035, "505": 16777215, "507": 858993459, "510": { "501": "string:第一行\n第二行较长" }, "512": 22, "513": 20 };
      const document = {
        filetype: "gia", dirtype: "Unknown", info: { "1": 0, "2": 0, "3": 0, "4": 0 }, dtype_csv: "",
        json: {
          "1": { "3": "string:Text alignment regression" },
          "2": [
            { "1": { "4": 1 }, "2": texts.map((text) => ({ "4": text.sourceNodeIndex })), "3": "string:Root", "19": { "1": { "505": [{ "12": { "501": "string:Root" } }, { "78": {}, "503": { "79": {} } }] } } },
            ...texts.map((text) => ({ "1": { "4": text.sourceNodeIndex }, "3": "string:1", "19": { "1": { "504": 1, "505": [{ "12": { "501": "string:1" } }, { "74": {}, "503": { "75": { ...textBody, ...text.body } } }] } } })),
          ],
        },
      };
      if (rotations) {
        document.json["2"][1]["19"]["1"]["505"].push({
          "11": {}, "503": { "13": { "12": { "501": rotations.map(([x, y, z], device) => ({
            "501": device, "502": { "508": { "1": x, "2": y, "3": z } },
          })) } } },
        });
      }
      // The codec's base schema predates client UI. Supply only the fixture's
      // wire types, as a decoded GIA document normally does for encode().
      const dtype = new Map();
      const declare = (value, keys) => {
        const repeated = Array.isArray(value);
        const values = repeated ? value : [value];
        for (const item of values) {
          const type = typeof item === "object" ? "object" : typeof item === "number" ? (keys.at(-2) === "508" || !Number.isInteger(item) ? "float32" : "int") : "string";
          dtype.set(keys.join("/"), `${keys.join("/")},${repeated ? "*" : ""},${type}`);
          if (type === "object") for (const [key, child] of Object.entries(item)) declare(child, [...keys, key]);
        }
      };
      for (const [key, value] of Object.entries(document.json)) declare(value, [key]);
      document.dtype_csv = [...dtype.values()].join("\n");
      return arrayBuffer(converter.encode(document));
    }
    async function checkImportRoundTrip(bytes, name, expected, mode = "pc", expectedRotations = []) {
      const api = createEditor();
      api.switchDevice(mode);
      const file = { name, arrayBuffer: async () => bytes };
      const imported = importer.importGiaControls(bytes, ["pc", "mobile", "controllerDesktop", "controllerMobile"].indexOf(mode));
      const hasUnknownAlignment = expected.some((alignment) => alignment.horizontalAlignment === null || alignment.verticalAlignment === null);
      const alignmentWarnings = imported.warnings.filter((warning) => warning.includes("对齐")).join("\n");
      assert.equal(Boolean(alignmentWarnings), hasUnknownAlignment, "Only unknown alignment values produce alignment warnings");
      for (const alignment of expected) {
        assert.equal(alignmentWarnings.includes(`#${alignment.sourceNodeIndex}`), alignment.horizontalAlignment === null || alignment.verticalAlignment === null, `Alignment warnings identify unknown source ${alignment.sourceNodeIndex} without confusing duplicate names`);
      }
      const project = JSON.parse(await api.createGiaProject(file));
      assert.equal(imported.controls.filter((control) => control.type === "text").length, expected.length, "Each source text control is checked even when names repeat");
      for (const alignment of expected) {
        const control = imported.controls.find((item) => item.sourceNodeIndex === alignment.sourceNodeIndex);
        const label = `source ${alignment.sourceNodeIndex}`;
        assert.ok(control, `${label} is present in the GIA import`);
        for (const field of ["horizontalAlignment", "verticalAlignment"]) {
          assert.ok(Object.hasOwn(control.properties, field), `${label}: importer must explicitly preserve ${field}`);
          assert.equal(control.properties[field], alignment[field], `${label}.${field}`);
        }
        assert.equal(control.properties.enableOutline ?? false, false, `${label}: vertical alignment must not enable outlines`);
        assert.equal(control.properties.adaptiveFontSize ?? false, false, `${label}: horizontal alignment must not enable adaptive font sizing`);
        assert.equal(Object.hasOwn(control.properties, "enableOutline"), false, `${label}: importer must not invent an outline field mapping`);
        assert.equal(Object.hasOwn(control.properties, "adaptiveFontSize"), false, `${label}: importer must not invent an adaptive font field mapping`);
        const node = project.nodes.find((item) => item.id === `gia_node_${control.sourceNodeIndex}`);
        assert.ok(node, `${label} is present in the created project`);
        assert.equal(node.properties.enableOutline, false, `${label}: created text retains the default outline setting`);
        assert.equal(node.properties.adaptiveFontSize, false, `${label}: created text retains the default adaptive font setting`);
        for (const [key, value] of Object.entries(control.properties)) {
          assert.deepEqual(node.properties[key], value, `${label}.${key} survives createGiaProject`);
        }
      }
      for (const { sourceNodeIndex, rotation } of expectedRotations) {
        const control = imported.controls.find((item) => item.sourceNodeIndex === sourceNodeIndex);
        assert.ok(control, `source ${sourceNodeIndex} exists in the GIA import`);
        assert.deepEqual([control.layout.rotationX, control.layout.rotationY, control.layout.rotationZ], rotation, `source ${sourceNodeIndex}: import preserves the X/Y/Z axes`);
      }
      const checkRotations = (nodes, stage) => {
        for (const { sourceNodeIndex, rotation } of expectedRotations) {
          const node = nodes.find((item) => item.id === `gia_node_${sourceNodeIndex}`);
          assert.ok(node, `source ${sourceNodeIndex} exists after ${stage}`);
          assert.deepEqual([node.rotationX, node.rotationY, node.rotation], rotation, `source ${sourceNodeIndex}: ${stage} preserves X/Y/Z and maps Z to canvas rotation`);
        }
      };
      checkRotations(project.nodes, "createGiaProject");
      await api.loadGiaFile({ target: { files: [file] } });
      checkRotations(api.nodes.value, "loadGiaFile");
      const baseline = plain(api.nodes.value);
      assert.ok(baseline.length > 0);
      await api.saveProject();
      const saved = api.getSavedProject();
      assert.deepEqual(saved.nodes, baseline, "Download preserves all imported controls and parameters");
      checkRotations(saved.nodes, "saveProject");
      const reloaded = createEditor();
      await reloaded.loadProject({ target: { files: [{ name: "roundtrip.json", text: async () => JSON.stringify(saved) }] } });
      assert.deepEqual(plain(reloaded.nodes.value), baseline, "A fresh editor reload preserves all imported controls");
      checkRotations(reloaded.nodes.value, "loadProject");
      for (const node of baseline.filter((item) => item.type === "text")) {
        const restored = reloaded.nodes.value.find((item) => item.id === node.id);
        assert.equal(restored.properties.enableOutline, false, `${node.id}: reload preserves the default outline setting`);
        assert.equal(restored.properties.adaptiveFontSize, false, `${node.id}: reload preserves the default adaptive font setting`);
        assert.deepEqual(plain(reloaded.textRenderStyle(restored)), plain(api.textRenderStyle(api.nodes.value.find((item) => item.id === node.id))), `${node.name}: reload preserves preview styling`);
      }
    }

    const nativeAlignments = [
      [0, 0, "left", "top"], [0, 1, "left", "middle"], [0, 2, "left", "bottom"],
      [1, 0, "middle", "top"], [1, 1, "middle", "middle"], [1, 2, "middle", "bottom"],
      [2, 0, "right", "top"], [2, 1, "right", "middle"], [2, 2, "right", "bottom"],
    ];
    await test("All nine native alignments import by source ID with duplicate names, without enabling outlines or adaptive font sizing", async () => {
      const texts = nativeAlignments.map(([horizontal, vertical], index) => ({ sourceNodeIndex: index + 2, body: { "508": horizontal, "509": vertical } }));
      const expected = nativeAlignments.map(([, , horizontalAlignment, verticalAlignment], index) => ({ sourceNodeIndex: index + 2, horizontalAlignment, verticalAlignment }));
      await checkImportRoundTrip(syntheticGia(texts), "nine-alignments.gia", expected);
    });
    await test("Omitted zero alignment fields restore left/top independently and survive project save/reload", async () => {
      const texts = [{ sourceNodeIndex: 2, body: {} }, { sourceNodeIndex: 3, body: { "508": 0, "509": 0 } }, { sourceNodeIndex: 4, body: { "508": 2 } }, { sourceNodeIndex: 5, body: { "509": 2 } }];
      const expected = [[2, "left", "top"], [3, "left", "top"], [4, "right", "top"], [5, "left", "bottom"]].map(([sourceNodeIndex, horizontalAlignment, verticalAlignment]) => ({ sourceNodeIndex, horizontalAlignment, verticalAlignment }));
      await checkImportRoundTrip(syntheticGia(texts), "omitted-alignment.gia", expected);
    });
    await test("Unknown numeric and nonnumeric alignments remain null with warnings while their valid axis survives", async () => {
      const texts = [{ sourceNodeIndex: 2, body: { "508": 3, "509": 1 } }, { sourceNodeIndex: 3, body: { "508": 2, "509": 99 } }, { sourceNodeIndex: 4, body: { "508": 0, "509": 2 } }];
      const expected = [[2, null, "middle"], [3, "right", null], [4, "left", "bottom"]].map(([sourceNodeIndex, horizontalAlignment, verticalAlignment]) => ({ sourceNodeIndex, horizontalAlignment, verticalAlignment }));
      await checkImportRoundTrip(syntheticGia(texts), "invalid-alignment.gia", expected);
      // Each encoded document has one wire type per field; exercise a malformed
      // string payload separately from unknown integer enum values.
      await checkImportRoundTrip(syntheticGia([{ sourceNodeIndex: 4, body: { "508": "string:invalid", "509": "string:invalid" } }]), "nonnumeric-alignment.gia", [{ sourceNodeIndex: 4, horizontalAlignment: null, verticalAlignment: null }]);
      await checkImportRoundTrip(syntheticGia([{ sourceNodeIndex: 5, body: { "508": 1.5, "509": 0 } }]), "fractional-alignment.gia", [{ sourceNodeIndex: 5, horizontalAlignment: null, verticalAlignment: "top" }]);
    });

    await test("Distinct X/Y/Z Euler rotations keep their axes and device values through import and project save/reload", async () => {
      const rotations = [[15, 25, 35], [-20, 40, 60], [0, 90, 0], [0, 0, 45]];
      const bytes = syntheticGia(undefined, rotations);
      for (const [index, mode] of ["pc", "mobile", "controllerDesktop", "controllerMobile"].entries()) {
        await checkImportRoundTrip(bytes, "rotation.gia", [{ sourceNodeIndex: 2, horizontalAlignment: "left", verticalAlignment: "top" }], mode, [{ sourceNodeIndex: 2, rotation: rotations[index] }]);
      }
    });

    await test("Text and text-window previews map all nine alignment combinations to horizontal, vertical and multiline CSS", () => {
      const horizontalCases = [["left", "flex-start", "left"], ["middle", "center", "center"], ["right", "flex-end", "right"]];
      const verticalCases = [["top", "flex-start"], ["middle", "center"], ["bottom", "flex-end"]];
      for (const type of ["text", "textWindow"]) {
        for (const [horizontalAlignment, justifyContent, textAlign] of horizontalCases) {
          for (const [verticalAlignment, alignItems] of verticalCases) {
            const api = createEditor();
            const node = api.makeNode(type, "Label", { properties: { text: "第一行\n第二行较长", horizontalAlignment, verticalAlignment } });
            api.nodes.value = [node];
            const style = api.textRenderStyle(api.nodes.value[0]);
            const label = `${type}: ${horizontalAlignment}/${verticalAlignment}`;
            assert.equal(style.justifyContent, justifyContent, `${label} horizontal block alignment`);
            assert.equal(style.alignItems, alignItems, `${label} vertical block alignment`);
            assert.equal(style.textAlign, textAlign, `${label} wrapped/explicit line alignment`);
          }
        }
      }
    });

    // Optional integration sample: the public regression never stores user files.
    const args = process.argv.slice(2);
    const writeIndex = args.indexOf("--write-project");
    let writeProject;
    if (writeIndex !== -1) {
      writeProject = args[writeIndex + 1];
      assert.ok(writeProject && path.isAbsolute(writeProject), "--write-project requires an absolute JSON output path");
      args.splice(writeIndex, 2);
    }
    assert.ok(!writeProject || args.length, "--write-project also requires a GIA sample");
    for (const [sampleIndex, sample] of args.entries()) {
      assert.ok(fs.existsSync(sample), `GIA sample does not exist: ${sample}`);
      const bytes = arrayBuffer(fs.readFileSync(sample));
      const document = converter.decode(bytes, { type: "gia" });
      const rawTextNodes = document.json["2"].filter((node) => node["19"]?.["1"]?.["505"]?.some((component) => Object.hasOwn(component, "74")));
      assert.ok(rawTextNodes.length > 0, "The sample contains serialized text components");
      const imported = importer.importGiaControls(bytes);
      const expected = [];
      for (const raw of rawTextNodes) {
        const control = imported.controls.find((item) => item.sourceNodeIndex === raw["1"]["4"]);
        assert.ok(control, "Every serialized text component is imported");
        assert.equal(control.type, "text");
        const component = raw["19"]["1"]["505"].find((item) => Object.hasOwn(item, "74"));
        const body = component["503"]?.["75"] ?? component["74"];
        // Both supplied exports retain these other native text parameters.
        assert.equal(body["501"], 20, `${control.name}: sample's native text preset`);
        assert.equal(body["503"], 12, `${control.name}: sample's native text configuration`);
        const native = nativeAlignments.find(([horizontal, vertical]) => horizontal === (body["508"] ?? 0) && vertical === (body["509"] ?? 0));
        assert.ok(native, `source ${control.sourceNodeIndex}: supplied sample uses a confirmed native alignment`);
        expected.push({ sourceNodeIndex: control.sourceNodeIndex, horizontalAlignment: native[2], verticalAlignment: native[3] });
      }
      const expectedRotations = [];
      for (const controlName of ["mask", "0", "1"]) {
        // The confirmation export also has nine text controls named "1".
        const control = imported.controls.find((item) => item.name === controlName && item.type !== "text");
        assert.ok(control, `The sample contains non-text ${controlName}`);
        expectedRotations.push({ sourceNodeIndex: control.sourceNodeIndex, rotation: [0, 0, 45] });
        const raw = document.json["2"].find((node) => node["1"]["4"] === control.sourceNodeIndex);
        const transform = raw["19"]["1"]["505"].find((component) => Object.hasOwn(component, "11"));
        const layouts = transform["503"]["13"]["12"]["501"];
        assert.equal(layouts.length, 4, `${controlName}: sample has all four device layouts`);
        for (const layout of layouts) {
          const rotation = layout["502"]["508"];
          assert.equal(rotation["1"] ?? 0, 0, `${controlName}: source X rotation is zero`);
          assert.equal(rotation["2"] ?? 0, 0, `${controlName}: source Y rotation is zero`);
          assert.ok(Math.abs(rotation["3"] - 45) < 0.001, `${controlName}: source Z rotation is 45 degrees`);
        }
      }
      await test(`${path.basename(sample)}: known task labels retain their confirmed alignments and duplicate names stay independent`, () => {
        const taskLabels = { Distance: ["left", "top"], Subtitle: ["left", "middle"], Text: ["left", "top"], Title: ["left", "middle"], Tip: ["left", "middle"] };
        for (const [name, alignment] of Object.entries(taskLabels)) {
          const source = imported.controls.find((control) => control.name === name && control.type === "text");
          assert.ok(source, `${name} exists in the supplied task UI`);
          const actual = expected.find((item) => item.sourceNodeIndex === source.sourceNodeIndex);
          assert.deepEqual([actual.horizontalAlignment, actual.verticalAlignment], alignment, `${name} agrees with the confirmed task UI`);
        }
        const repeated = imported.controls.filter((control) => control.name === "1" && control.type === "text");
        if (repeated.length) {
          assert.equal(repeated.length, 9, "The confirmation sample contains all nine identically named text controls");
          const actual = repeated.map((control) => expected.find((item) => item.sourceNodeIndex === control.sourceNodeIndex));
          assert.equal(new Set(actual.map((item) => item.sourceNodeIndex)).size, 9, "Repeated labels never overwrite another source control");
          const combinations = actual.map((item) => `${item.horizontalAlignment}/${item.verticalAlignment}`).sort();
          assert.deepEqual(combinations, nativeAlignments.map(([, , horizontal, vertical]) => `${horizontal}/${vertical}`).sort());
          // Fixed expectations from the independently exported 3-by-3 matrix.
          const confirmed = [
            [1073755170, "right", "bottom"], [1073755171, "middle", "bottom"], [1073755172, "left", "bottom"],
            [1073755173, "right", "middle"], [1073755174, "middle", "middle"], [1073755175, "left", "middle"],
            [1073755176, "right", "top"], [1073755177, "middle", "top"], [1073755178, "left", "top"],
          ];
          for (const [sourceNodeIndex, horizontal, vertical] of confirmed) {
            const control = imported.controls.find((item) => item.sourceNodeIndex === sourceNodeIndex);
            assert.ok(control, `Matrix source ${sourceNodeIndex} exists`);
            assert.deepEqual([control.properties.horizontalAlignment, control.properties.verticalAlignment], [horizontal, vertical], `Matrix source ${sourceNodeIndex}`);
          }
        }
      });
      for (const mode of ["pc", "mobile", "controllerDesktop", "controllerMobile"]) {
        await test(`${path.basename(sample)}: text alignment and mask/0/1 Z rotations survive import, project creation and save/reload on ${mode}`, () => checkImportRoundTrip(bytes, path.basename(sample), expected, mode, expectedRotations));
      }
      if (writeProject && sampleIndex === 0) {
        const api = createEditor();
        const serialized = await api.createGiaProject({ name: path.basename(sample), arrayBuffer: async () => bytes });
        fs.writeFileSync(writeProject, JSON.stringify(JSON.parse(serialized), null, 2) + "\n");
        console.log(`WROTE ${writeProject} (unmodified import)`);
      }
    }
    if (!args.length) {
      console.log("SKIP actual GIA samples (pass the task-tracking and/or alignment-confirmation GIA paths to enable).");
    }
  } finally {
    Module._load = originalLoad;
    if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
    else delete Module._extensions[".ts"];
  }
  console.log(`\n${passed} client UI GIA text-alignment and rotation checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
