/* Run: node scripts/test-client-ui-property-actions.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { reactive } = require("vue");

const originalTsExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  module._compile(compiled.outputText, filename);
};

let passed = 0;
try {
  const editor = path.resolve(__dirname, "../src/views/ClientUIAnimationEditor");
  const { controlRegistry } = require(path.join(editor, "controlRegistry.ts"));
  const { capturePropertyGroup, canPastePropertyGroup, pastePropertyGroup, resetPropertyGroup } = require(path.join(editor, "propertyGroupActions.ts"));
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const groups = ["transform", "image", "control", "creation", "editor"];
  function test(name, check) { check(); passed += 1; console.log(`PASS ${name}`); }
  function makeNode(type, id = type) {
    return {
      id, type, name: `Name ${id}`, parentId: "root", properties: controlRegistry[type].createProperties(),
      x: 820, y: 480, width: 720, height: 200, active: false, visible: false,
      anchorMinX: 0.1, anchorMinY: 0.2, anchorMaxX: 0.8, anchorMaxY: 0.9,
      pivotX: 0.3, pivotY: 0.4, anchorOffsetX: 21, anchorOffsetY: -32,
      sizeDeltaX: -55, sizeDeltaY: 330, scaleX: 1.1, scaleY: 1.2, scaleZ: 1.3,
      rotationX: 10, rotationY: 20, rotation: 30, locked: true, canControllerFocus: true,
    };
  }
  function identityAndLayout(node) {
    return { id: node.id, name: node.name, type: node.type, parentId: node.parentId, x: node.x, y: node.y, width: node.width, height: node.height };
  }

  test("Every control type resets to registry properties and its default anchored transform", () => {
    for (const [type, definition] of Object.entries(controlRegistry)) {
      const node = makeNode(type);
      const identity = identityAndLayout(node);
      const properties = plain(node.properties);
      assert.equal(resetPropertyGroup(node, "transform"), true);
      assert.deepEqual(capturePropertyGroup(node, "transform").values, {
        anchorMinX: 0.5, anchorMinY: 0.5, anchorMaxX: 0.5, anchorMaxY: 0.5,
        pivotX: 0.5, pivotY: 0.5, anchorOffsetX: 0, anchorOffsetY: 0,
        sizeDeltaX: definition.defaultWidth, sizeDeltaY: definition.defaultHeight,
        scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 0,
      });
      assert.deepEqual(identityAndLayout(node), identity);
      assert.deepEqual(node.properties, properties);
      for (const key of Object.keys(node.properties)) node.properties[key] = null;
      const transform = capturePropertyGroup(node, "transform").values;
      assert.equal(resetPropertyGroup(node, "control"), true);
      assert.deepEqual(node.properties, definition.createProperties());
      assert.deepEqual(capturePropertyGroup(node, "transform").values, transform);
      assert.deepEqual(identityAndLayout(node), identity);
      assert.equal(node.active, false);
      assert.equal(node.locked, true);
    }
  });

  test("Transform copies across types without changing identity, derived layout, properties or Tween data", () => {
    const source = makeNode("image", "source");
    source.tweenTracks = [{ id: "tween", fieldKey: "rotation", endValue: 80 }];
    const target = makeNode("text", "target");
    target.anchorOffsetY = 800;
    target.tweenTracks = [{ id: "target-tween", fieldKey: "scaleX", endValue: 2 }];
    const before = plain(target);
    const clipboard = capturePropertyGroup(source, "transform");
    assert.equal(canPastePropertyGroup(target, "transform", clipboard), true);
    assert.equal(pastePropertyGroup(target, "transform", clipboard), true);
    assert.deepEqual(target, { ...before, ...clipboard.values });
    for (const key of ["id", "name", "type", "parentId", "properties", "tweenTracks", "x", "y", "width", "height"]) {
      assert.equal(Object.hasOwn(clipboard.values, key), false, key);
    }
    source.anchorOffsetY = 999;
    assert.equal(clipboard.values.anchorOffsetY, -32);
  });

  test("Control paste refuses different types and all groups refuse a different clipboard group", () => {
    const image = makeNode("image");
    const text = makeNode("text");
    const before = plain(text);
    const controlClipboard = capturePropertyGroup(image, "control");
    assert.equal(canPastePropertyGroup(text, "control", controlClipboard), false);
    assert.equal(pastePropertyGroup(text, "control", controlClipboard), false);
    assert.deepEqual(text, before);
    for (const sourceGroup of groups) {
      const clipboard = capturePropertyGroup(image, sourceGroup);
      for (const targetGroup of groups.filter((group) => group !== sourceGroup)) {
        const imageBefore = plain(image);
        assert.equal(canPastePropertyGroup(image, targetGroup, clipboard), false);
        assert.equal(pastePropertyGroup(image, targetGroup, clipboard), false);
        assert.deepEqual(image, imageBefore);
      }
    }
  });

  test("Reactive control snapshots and repeated pastes never share nested colors; null values survive", () => {
    const source = reactive(makeNode("text", "source"));
    source.properties.fontColor.r = 37;
    source.properties.fontSize = null;
    source.properties.horizontalAlignment = null;
    const clipboard = capturePropertyGroup(source, "control");
    source.properties.fontColor.r = 99;
    assert.equal(clipboard.values.fontColor.r, 37);
    const target = reactive(makeNode("text", "target"));
    const before = plain(target);
    assert.equal(pastePropertyGroup(target, "control", clipboard), true);
    assert.deepEqual(plain(target), { ...before, properties: plain(clipboard.values) });
    assert.equal(target.properties.fontSize, null);
    assert.equal(target.properties.horizontalAlignment, null);
    target.properties.fontColor.r = 200;
    assert.equal(clipboard.values.fontColor.r, 37);
    assert.equal(source.properties.fontColor.r, 99);
    const secondTarget = makeNode("text", "second");
    assert.equal(pastePropertyGroup(secondTarget, "control", clipboard), true);
    assert.equal(secondTarget.properties.fontColor.r, 37);
    secondTarget.properties.bgColor.a = 0.75;
    assert.equal(target.properties.bgColor.a, 0);
    assert.equal(clipboard.values.bgColor.a, 0);
    resetPropertyGroup(secondTarget, "control");
    secondTarget.properties.fontColor.r = 0;
    assert.equal(controlRegistry.text.createProperties().fontColor.r, 255);
  });

  test("Image actions copy source, ID, tint and type while preserving mask/fill settings", () => {
    const source = makeNode("image", "source");
    source.properties.imageId = null;
    source.properties.imageColor.r = 67;
    source.properties.imageType = "stretch";
    const clipboard = capturePropertyGroup(source, "image");
    assert.deepEqual(clipboard.values, { imageSource: "staticReference", imageId: null, imageColor: source.properties.imageColor, imageType: "stretch" });
    const target = makeNode("image", "target");
    target.properties.imageColor.r = 12;
    target.properties.fillAmount = 0.6;
    const before = plain(target);
    assert.equal(pastePropertyGroup(target, "image", clipboard), true);
    assert.deepEqual(target, { ...before, properties: { ...before.properties, ...clipboard.values } });
    target.properties.imageColor.r = 45;
    assert.equal(clipboard.values.imageColor.r, 67);
    assert.equal(resetPropertyGroup(target, "image"), true);
    assert.deepEqual(target, { ...before, properties: { ...before.properties, imageColor: { r: 255, g: 255, b: 255, a: 1 } } });
    const text = makeNode("text");
    const textBefore = plain(text);
    assert.equal(capturePropertyGroup(text, "image"), null);
    assert.equal(canPastePropertyGroup(text, "image", clipboard), false);
    assert.equal(pastePropertyGroup(text, "image", clipboard), false);
    assert.equal(resetPropertyGroup(text, "image"), false);
    assert.deepEqual(text, textBefore);
  });

  test("Creation and editor actions stay within their group and reset to initial booleans", () => {
    for (const [group, defaults] of [["creation", { active: true, visible: true }], ["editor", { locked: false, canControllerFocus: false }]]) {
      const source = makeNode("container", "source");
      const target = makeNode("reference", "target");
      const before = plain(target);
      assert.equal(resetPropertyGroup(source, group), true);
      assert.deepEqual(capturePropertyGroup(source, group).values, defaults);
      const clipboard = capturePropertyGroup(source, group);
      assert.equal(pastePropertyGroup(target, group, clipboard), true);
      assert.deepEqual(target, { ...before, ...defaults });
      assert.deepEqual(capturePropertyGroup(target, group).values, defaults);
      const other = group === "creation" ? "editor" : "creation";
      assert.deepEqual(capturePropertyGroup(target, other).values, capturePropertyGroup(before, other).values);
    }
  });

  test("An empty clipboard never changes any group", () => {
    const node = makeNode("image");
    const before = plain(node);
    for (const group of groups) {
      assert.equal(canPastePropertyGroup(node, group, null), false);
      assert.equal(pastePropertyGroup(node, group, null), false);
      assert.deepEqual(node, before);
    }
  });
} finally {
  if (originalTsExtension) Module._extensions[".ts"] = originalTsExtension;
  else delete Module._extensions[".ts"];
}
console.log(`\n${passed} client UI property-group checks passed.`);
