/* Run: node scripts/test-client-ui-control-templates.cjs [template.gia ...] */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

async function main() {
  const converter = await import("genshin-impact-ugc-file-converter-web");
  const originalLoad = Module._load, originalTs = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) { return request === "genshin-impact-ugc-file-converter-web" ? converter : originalLoad.call(this, request, parent, isMain); };
  Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, file);
  try {
    const { readControlTemplate, buildTemplateScene, normalizeControlTemplates, templateIndexError } = require("../src/views/ClientUIAnimationEditor/controlTemplates.ts");
    const { importGiaControls } = require("../src/views/ClientUIAnimationEditor/giaImporter.ts");
    const clone = value => JSON.parse(JSON.stringify(value));
    const bytes = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .001, `${actual} != ${expected}`);
    function rawControl(id, parent, children, size, rotation = 0) {
      return { "1": { "4": id }, ...(children.length ? { "2": children.map(child => ({ "4": child })) } : {}), "3": `string:Control ${id}`,
        "19": { "1": { ...(parent ? { "504": parent } : {}), "505": [
          { [parent ? "83" : "78"]: {}, "503": { [parent ? "84" : "79"]: parent ? { "502": 4294967295, "503": 100001 } : {} } },
          { "11": {}, "503": { "13": { "12": { "501": [0, 1, 2, 3].map(device => ({ "501": device, "502": {
            "501": { "1": parent ? 1 : .25, "2": parent ? 1 : .25, "3": 1 },
            "502": { "501": .5, "502": .5 }, "503": { "501": .5, "502": .5 },
            "505": { "501": size + device * 10, "502": size }, "506": { "501": .5, "502": .5 }, "508": { "3": rotation },
          } })) } } } },
        ] } } };
    }
    function encode(json) {
      const types = new Map();
      function declare(value, keys) {
        const repeated = Array.isArray(value);
        for (const item of repeated ? value : [value]) {
          const type = typeof item === "object" ? "object" : typeof item === "number" ? (keys.at(-2) === "508" || !Number.isInteger(item) || types.get(keys.join("/"))?.endsWith(",float32") ? "float32" : "int") : "string";
          types.set(keys.join("/"), `${keys.join("/")},${repeated ? "*" : ""},${type}`);
          if (type === "object") for (const [key, child] of Object.entries(item)) declare(child, [...keys, key]);
        }
      }
      for (const [key, value] of Object.entries(json)) declare(value, [key]);
      return bytes(converter.encode({ filetype: "gia", dirtype: "Unknown", info: { "1": 0, "2": 0, "3": 0, "4": 0 }, dtype_csv: [...types.values()].join("\n"), json }));
    }
    const primary = rawControl(1, null, [2, 3], 150);
    const children = [rawControl(2, 1, [], 80, 45), rawControl(3, 1, [], 20, 45)];
    const input = encode({ "1": primary, "2": children });
    const asset = readControlTemplate(input, "test.gia", 0);
    assert.equal(asset.devices.length, 4);
    assert.deepEqual(asset.devices[0].map(control => control.sourceNodeIndex), [1, 3, 2]);
    assert.equal(asset.devices[0][0].layout.scaleX, .25);
    assert.equal(asset.devices[3][0].layout.sizeDeltaX, 180);
    const scene = buildTemplateScene(asset);
    near(scene.width, 37.5); near(scene.height, 37.5);
    assert.deepEqual(scene.nodes.map(node => node.control.sourceNodeIndex), [1, 2, 3]);
    near(scene.nodes[1].matrix.a, Math.SQRT1_2 * .25);
    near(buildTemplateScene(asset, 3).width, 45);
    assert.deepEqual(normalizeControlTemplates(JSON.parse(JSON.stringify([asset]))), [asset]);
    console.log("PASS template primary root, device layouts, root scale, paint order and persistence");

    const wrapper = encode({ "1": { "3": "string:Ordinary UI project" }, "2": [primary, ...children] });
    assert.equal(importGiaControls(wrapper).controls.length, 3);
    assert.equal(importGiaControls(encode({ "1": primary, "2": [primary, ...children] })).controls.length, 3);
    assert.throws(() => readControlTemplate(new ArrayBuffer(3), "invalid.gia", 1));
    assert.ok(templateIndexError(.5, [])); assert.ok(templateIndexError(-1, [])); assert.ok(templateIndexError(0, [asset]));
    assert.equal(templateIndexError(0, [asset], asset.id), "");
    const cyclic = clone(asset); cyclic.devices[0][0].parentSourceNodeIndex = 2;
    assert.throws(() => normalizeControlTemplates([cyclic]), /循环/);
    console.log("PASS ordinary GIA import compatibility, deduplication and invalid data rejection");

    const transformed = clone(asset);
    transformed.devices[0][0].layout.rotationZ = 90;
    transformed.devices[0][0].layout.scaleX = -.5;
    transformed.devices[0].find(control => control.sourceNodeIndex === 2).layout.anchoredPositionX = 20;
    const movedScene = buildTemplateScene(transformed), child = movedScene.nodes.find(node => node.control.sourceNodeIndex === 2);
    near(child.x, 0); near(child.y, -10);
    transformed.devices[0][0].layout.active = false;
    assert.equal(buildTemplateScene(transformed).nodes.length, 0);
    console.log("PASS parent rotation, reflection, anchored offset and hidden subtree rendering");

    for (const file of process.argv.slice(2)) {
      const real = readControlTemplate(bytes(fs.readFileSync(file)), path.basename(file), 1);
      const realScene = buildTemplateScene(real);
      assert.ok(realScene.nodes.length && Number.isFinite(realScene.width));
      assert.deepEqual(normalizeControlTemplates(JSON.parse(JSON.stringify([real]))), [real]);
      if (path.basename(file) === "任务MainLine图标.gia") {
        assert.equal(real.devices[0].length, 14);
        assert.equal(real.devices[0].filter(node => node.type === "image").length, 13);
        assert.equal(real.devices[0][0].layout.scaleX, .25);
        near(realScene.width, 37.5); near(realScene.height, 37.5);
      }
      console.log(`PASS actual template ${real.name}: ${real.devices[0].length} controls, ${realScene.width} × ${realScene.height}`);
    }
  } finally { Module._load = originalLoad; if (originalTs) Module._extensions[".ts"] = originalTs; else delete Module._extensions[".ts"]; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
