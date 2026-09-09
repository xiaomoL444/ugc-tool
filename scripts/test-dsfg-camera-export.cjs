/* Run with: node scripts/test-dsfg-camera-export.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

async function main() {
  const variableLibrary = await import("miliastra-variable");
  const rootDirectory = path.resolve(__dirname, "..");
  const editorDirectory = path.join(rootDirectory, "src/views/DSFGStudio/components/DialogueEditor");
  const originalLoad = Module._load;
  const originalTypescriptExtension = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) {
    if (request === "miliastra-variable") return variableLibrary;
    const resolved = request.startsWith("@/")
      ? path.join(rootDirectory, "src", request.slice(2))
      : request;
    return originalLoad.call(this, resolved, parent, isMain);
  };
  Module._extensions[".ts"] = (module, filename) => {
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    module._compile(compiled.outputText, filename);
  };

  try {
    const { exportQxqyPerformance } = require(path.join(editorDirectory, "utils/qxqyPerformanceExporter.ts"));
    const {
      createDefaultQxqyStructIds,
      createQxqyStructWorkspace,
      normalizeQxqyStructIds,
    } = require(path.join(editorDirectory, "utils/qxqyStructWorkspace.ts"));
    const {
      CAMERA_CLIP_COMPONENT_TEMPLATE,
      CAMERA_POSITION_PROPERTIES,
      CAMERA_ROTATION_PROPERTIES,
      CAMERA_SLOT_PROPERTIES,
    } = require(path.join(editorDirectory, "config/cameraClip.ts"));
    const { createClipComponent } = require(path.join(editorDirectory, "config/clipComponentRegistry.ts"));
    const { createClipPropertyValues, isClipPropertyVisible } = require(path.join(editorDirectory, "utils/clipProperties.ts"));
    const { encodeDialogueProject, decodeDialogueProject } = require(path.join(editorDirectory, "utils/dialogueProjectCodec.ts"));
    let passed = 0;
    function test(name, check) {
      check();
      passed += 1;
      console.log(`PASS ${name}`);
    }
    function camera(properties = {}, index = 0) {
      return {
        id: `camera-${index}`, type: "Camera", name: `镜头 ${index}`,
        startTime: 2.9, duration: 1.25,
        components: [{ id: `shot-${index}`, templateId: "camera.shot", name: "运镜", enabled: true, properties }],
      };
    }
    function project(clips = [camera()]) {
      return {
        schemaVersion: 12,
        exportSettings: { qxqyStructIds: createDefaultQxqyStructIds() },
        dialogue: {
          tree: null, entryNodeId: "entry", conditionBranches: {},
          nodes: {
            group: {
              id: "group", name: "测试 Group", nodeType: "Dialogue", durationMode: "Auto",
              dialogue: { id: "dialog", style: "Default_UI", speaker: "测试角色", content: "测试台词", subtitle: "副标题", startTime: 0, continueDelayTime: 0.5, advanceMode: "PlayerInput", nodeGraphEvent: ["42"] },
              lines: [{ id: "camera-line", name: "Camera", type: "Camera", clips }],
              timeline: { maxLines: 8, duration: 2 }, next: [],
            },
          },
        },
        graph: {
          nodes: [{ id: "entry", type: "entry", position: { x: 0, y: 0 } }, { id: "group", type: "group", position: { x: 100, y: 0 } }],
          edges: [{ id: "entry-group", source: "entry", target: "group" }],
        },
      };
    }
    function exported(source) {
      const result = exportQxqyPerformance(source);
      const workspace = createQxqyStructWorkspace(source.exportSettings.qxqyStructIds);
      const parsed = workspace.parse(JSON.parse(result.json));
      assert.deepEqual(parsed.issues, []);
      return { result, parsed, workspace };
    }
    const table = (dictionary) => dictionary.value.flatMap((entry) => entry.value.value);
    const slot = (overrides = {}) => ({
      space: 1, pointType: "自定义定位方式", vector3: "-160, 900, 0.125",
      guid: "18446744073709551615", entity: "主角实体", attachmentPoint: "Head",
      offset: "0,-0.5,2", requiresClientPos: true, ...overrides,
    });
    const parameters = () => ({
      cameraName: "镜头 A",
      positionData: { type: "自定义位置模式", slot: [slot(), slot({ entity: "第二个目标", guid: "2" })], snapToTarget: true, orbitRot: "10,-20,30", orbitRadius: 2.75 },
      rotationData: { type: "自定义旋转模式", slot: [slot({ pointType: "look-at", space: 0 })], snapToTarget: false },
    });

    test("Camera templates match source keys and order with explicit editor-default overrides", () => {
      const ids = createDefaultQxqyStructIds();
      const workspace = createQxqyStructWorkspace(ids);
      const cameraDefault = workspace.createDefault(ids.camera);
      const fields = cameraDefault.value;
      // UI deliberately places cameraName first; export always follows source field order.
      assert.deepEqual(CAMERA_CLIP_COMPONENT_TEMPLATE.properties.map((property) => property.key).sort(), Object.keys(fields).filter((key) => key !== "duration").sort());
      for (const [properties, value] of [[CAMERA_POSITION_PROPERTIES, fields.positionData], [CAMERA_ROTATION_PROPERTIES, fields.rotationData], [CAMERA_SLOT_PROPERTIES, workspace.createDefault(ids.cameraSlot)]]) {
        assert.deepEqual(properties.map((property) => property.key), Object.keys(value.value));
      }
      function plain(value) {
        if (value.type === "Struct") return Object.fromEntries(Object.entries(value.value).map(([key, field]) => [key, plain(field)]));
        if (value.type === "StructList") return value.value.map(plain);
        if (value.type === "Bool") return value.value === "True";
        if (value.type === "Float" || value.type === "Int32") return Number(value.value);
        return value.value;
      }
      const { duration: _duration, ...expected } = plain(cameraDefault);
      // Business defaults are intentionally different from the original exported JSON.
      expected.cameraName = "Default";
      expected.positionData.type = "Fixed";
      const first = createClipComponent("camera.shot");
      const second = createClipComponent("camera.shot");
      assert.deepEqual(first.properties, expected);
      assert.deepEqual(createClipPropertyValues(CAMERA_SLOT_PROPERTIES), { ...plain(workspace.createDefault(ids.cameraSlot)), pointType: "Vector3" });
      first.properties.positionData.slot.push(createClipPropertyValues(CAMERA_SLOT_PROPERTIES));
      first.properties.rotationData.type = "changed";
      assert.deepEqual(second.properties, expected);
      assert.equal(first.properties.rotationData.slot.length, 0);
    });

    test("Camera selectors have explicit typed choices and rotation type remains free text", () => {
      const positionType = CAMERA_POSITION_PROPERTIES.find((property) => property.key === "type");
      assert.equal(positionType.type, "select");
      assert.equal(positionType.defaultValue, "Fixed");
      assert.deepEqual(positionType.options.map((option) => option.value), ["Fixed", "Linear", "Follow", "Orbit"]);
      const space = CAMERA_SLOT_PROPERTIES.find((property) => property.key === "space");
      assert.equal(space.type, "select");
      assert.equal(space.defaultValue, 0);
      assert.deepEqual(space.options.map((option) => option.value), [0, 1]);
      assert.ok(space.options[0].label.includes("Local"));
      assert.ok(space.options[1].label.includes("World"));
      const pointType = CAMERA_SLOT_PROPERTIES.find((property) => property.key === "pointType");
      assert.equal(pointType.type, "select");
      assert.equal(pointType.defaultValue, "Vector3");
      assert.deepEqual(pointType.options.map((option) => option.value), ["Vector3", "Guid", "Entity"]);
      assert.equal(CAMERA_ROTATION_PROPERTIES.find((property) => property.key === "type").type, "string");
      const name = CAMERA_CLIP_COMPONENT_TEMPLATE.properties.find((property) => property.key === "cameraName");
      assert.equal(name.type, "string");
      assert.equal(name.defaultValue, "Default");
      for (const properties of [CAMERA_POSITION_PROPERTIES, CAMERA_ROTATION_PROPERTIES]) {
        assert.equal(properties.find((property) => property.key === "slot").properties, CAMERA_SLOT_PROPERTIES);
      }
      for (const selected of space.options) {
        const properties = createClipPropertyValues(CAMERA_SLOT_PROPERTIES);
        properties.space = selected.value;
        assert.equal(typeof properties.space, "number");
        const decoded = decodeDialogueProject(encodeDialogueProject(project([camera({ positionData: { slot: [properties] } })])));
        const restored = decoded.dialogue.nodes.group.lines[0].clips[0].components[0].properties.positionData.slot[0];
        assert.equal(restored.space, selected.value);
        assert.equal(typeof restored.space, "number");
        const { parsed } = exported(decoded);
        assert.equal(table(parsed.value.CameraMovementDate)[0].value.positionData.value.slot.value[0].value.space.value, String(selected.value));
      }
    });

    test("Slot visibility follows point type and compares condition values without coercion", () => {
      const common = ["space", "pointType"];
      for (const [pointType, expected] of [
        ["Vector3", [...common, "vector3"]],
        ["Guid", [...common, "guid", "attachmentPoint", "offset", "requiresClientPos"]],
        ["Entity", [...common, "entity", "attachmentPoint", "offset", "requiresClientPos"]],
      ]) {
        const values = { ...slot(), pointType };
        assert.deepEqual(CAMERA_SLOT_PROPERTIES.filter((property) => isClipPropertyVisible(property, values)).map((property) => property.key), expected);
      }
      const conditional = { key: "test", label: "test", type: "string", defaultValue: "", visibleWhen: { key: "space", values: [1] } };
      assert.equal(isClipPropertyVisible(conditional, { space: 1 }), true);
      assert.equal(isClipPropertyVisible(conditional, { space: "1" }), false);
      assert.equal(isClipPropertyVisible(conditional, {}), false);
      assert.equal(isClipPropertyVisible({ ...conditional, visibleWhen: undefined }, {}), true);
    });

    test("Switching point types hides fields without deleting them from codec or complete exports", () => {
      const properties = parameters();
      const selectedSlot = properties.positionData.slot[0];
      selectedSlot.customPreserved = { note: "keep hidden fields" };
      const original = structuredClone(selectedSlot);
      for (const pointType of ["Vector3", "Guid", "Entity", "Vector3"]) {
        selectedSlot.pointType = pointType;
        const beforeVisibility = JSON.stringify(properties);
        CAMERA_SLOT_PROPERTIES.filter((property) => isClipPropertyVisible(property, selectedSlot));
        assert.equal(JSON.stringify(properties), beforeVisibility);
        const restored = decodeDialogueProject(encodeDialogueProject(project([camera(properties)])));
        const restoredSlot = restored.dialogue.nodes.group.lines[0].clips[0].components[0].properties.positionData.slot[0];
        assert.deepEqual(restoredSlot, { ...original, pointType });
        const { parsed } = exported(restored);
        const value = table(parsed.value.CameraMovementDate)[0].value.positionData.value.slot.value[0].value;
        assert.deepEqual(Object.keys(value), CAMERA_SLOT_PROPERTIES.map((property) => property.key));
        assert.equal(value.pointType.value, pointType);
        assert.equal(value.vector3.value, "-160,900,0.125");
        assert.equal(value.guid.value, "18446744073709551615");
        assert.equal(value.entity.value, "主角实体");
        assert.equal(value.attachmentPoint.value, "Head");
        assert.equal(value.offset.value, "0,-0.5,2");
        assert.equal(value.requiresClientPos.value, "True");
      }
    });

    test("Existing blank and unknown selector values are preserved rather than silently defaulted", () => {
      for (const saved of ["", "future-custom-value"]) {
        const source = project([camera({ cameraName: saved, positionData: { type: saved, slot: [{ pointType: saved, space: 9, guid: "123", entity: "stored entity" }] }, rotationData: { type: saved } })]);
        const restored = decodeDialogueProject(encodeDialogueProject(source));
        const properties = restored.dialogue.nodes.group.lines[0].clips[0].components[0].properties;
        assert.equal(properties.cameraName, saved);
        assert.equal(properties.positionData.type, saved);
        assert.equal(properties.positionData.slot[0].pointType, saved);
        assert.equal(properties.positionData.slot[0].space, 9);
        assert.equal(properties.rotationData.type, saved);
        const { parsed } = exported(restored);
        const value = table(parsed.value.CameraMovementDate)[0].value;
        assert.equal(value.cameraName.value, saved);
        assert.equal(value.positionData.value.type.value, saved);
        assert.equal(value.positionData.value.slot.value[0].value.pointType.value, saved);
        assert.equal(value.positionData.value.slot.value[0].value.space.value, "9");
      }
    });

    test("Project codec preserves nested camera data, custom properties and all custom IDs", () => {
      const properties = parameters();
      properties.customMetadata = { tags: ["A", "B"], enabled: true };
      properties.positionData.customPosition = { easing: "future-mode" };
      properties.positionData.slot[0].customSlot = { weight: 0.75 };
      properties.rotationData.slot[0].customRotation = [1, 2, 3];
      const source = project([camera(properties)]);
      source.exportSettings.qxqyStructIds = Object.fromEntries(Object.keys(createDefaultQxqyStructIds()).map((key, index) => [key, String(3077936100 + index)]));
      const decoded = decodeDialogueProject(encodeDialogueProject(source));
      assert.equal(decoded.schemaVersion, 12);
      assert.deepEqual(decoded.exportSettings.qxqyStructIds, source.exportSettings.qxqyStructIds);
      assert.deepEqual(decoded.dialogue.nodes.group.lines[0].clips[0].components[0].properties, properties);
      assert.deepEqual(exportQxqyPerformance(decoded).value, exportQxqyPerformance(source).value);
      const repeated = decodeDialogueProject(encodeDialogueProject(decoded));
      assert.deepEqual(repeated.dialogue.nodes.group.lines[0].clips[0], decoded.dialogue.nodes.group.lines[0].clips[0]);
    });

    test("Legacy camera.shot gets V2 defaults without guessing old field meanings", () => {
      const defaults = createClipComponent("camera.shot").properties;
      for (const legacy of [{}, { camera: "Legacy Camera", blendDuration: 0.75 }]) {
        const source = project([camera(legacy)]);
        source.schemaVersion = 11;
        const decoded = decodeDialogueProject(JSON.stringify(source));
        assert.equal(decoded.schemaVersion, 12);
        const properties = decoded.dialogue.nodes.group.lines[0].clips[0].components[0].properties;
        assert.deepEqual(properties, { ...legacy, ...defaults });
        assert.equal(properties.cameraName, "Default");
        const { parsed } = exported(decoded);
        const value = table(parsed.value.CameraMovementDate)[0];
        assert.equal(value.value.cameraName.value, "Default");
        assert.equal(value.value.positionData.value.type.value, "Fixed");
        assert.equal(value.value.positionData.value.slot.itemCount, 0);
        assert.equal(value.value.positionData.value.orbitRadius.value, "0");
        assert.equal(Object.hasOwn(value.value, "camera"), false);
        assert.equal(Object.hasOwn(value.value, "blendDuration"), false);
        assert.deepEqual(decodeDialogueProject(encodeDialogueProject(decoded)).dialogue.nodes.group.lines[0].clips[0].components[0].properties, properties);
      }
    });

    test("Partial nested parameters fill missing defaults without reordering existing slots", () => {
      const source = project([camera({
        positionData: { slot: [{ entity: "third", customKey: "keep" }, { entity: "first", guid: "9007199254740993", vector3: "1,2,3" }, { entity: "second", space: 2 }] },
        rotationData: { slot: [{ attachmentPoint: "Head" }], snapToTarget: true },
      })]);
      const decoded = decodeDialogueProject(encodeDialogueProject(source));
      const properties = decoded.dialogue.nodes.group.lines[0].clips[0].components[0].properties;
      assert.equal(properties.cameraName, "Default");
      assert.equal(properties.positionData.type, "Fixed");
      assert.equal(properties.positionData.snapToTarget, false);
      assert.equal(properties.positionData.orbitRadius, 0);
      assert.equal(properties.positionData.orbitRot, "0,0,0");
      assert.deepEqual(properties.positionData.slot.map((item) => item.entity), ["third", "first", "second"]);
      assert.equal(properties.positionData.slot[0].customKey, "keep");
      assert.equal(properties.positionData.slot[0].guid, "0");
      assert.equal(properties.positionData.slot[0].vector3, "0,0,0");
      assert.equal(properties.positionData.slot[1].guid, "9007199254740993");
      assert.equal(properties.positionData.slot[1].vector3, "1,2,3");
      assert.equal(properties.rotationData.type, "");
      assert.equal(properties.rotationData.snapToTarget, true);
      assert.equal(properties.rotationData.slot[0].attachmentPoint, "Head");
      assert.equal(properties.rotationData.slot[0].requiresClientPos, false);
      const { parsed } = exported(decoded);
      const slots = table(parsed.value.CameraMovementDate)[0].value.positionData.value.slot.value;
      assert.deepEqual(slots.map((item) => item.value.entity.value), ["third", "first", "second"]);
      assert.deepEqual(decodeDialogueProject(encodeDialogueProject(decoded)).dialogue.nodes.group.lines[0].clips[0].components[0].properties, properties);
    });

    test("CameraClip embedded defaults and source field order", () => {
      const source = project();
      const { parsed, workspace } = exported(source);
      const value = table(parsed.value.CameraMovementDate)[0];
      assert.deepEqual(Object.keys(value.value), ["duration", "positionData", "rotationData", "cameraName"]);
      assert.equal(value.value.duration.value, "1.25");
      assert.equal(value.value.cameraName.value, "");
      assert.equal(value.value.positionData.value.orbitRadius.value, "0.00");
      assert.equal(value.value.positionData.value.slot.itemCount, 0);
      assert.equal(value.value.rotationData.value.slot.itemCount, 0);
      const standalone = workspace.createDefault(source.exportSettings.qxqyStructIds.cameraPosition);
      assert.equal(standalone.value.orbitRadius.value, "2.00");
      assert.equal(standalone.value.slot.itemCount, 1);
      assert.equal(parsed.value.CameraMovementDate.toParamNode().value.key_type, "String");
    });

    test("Nested position, rotation and ordered target slots preserve values", () => {
      const { parsed } = exported(project([camera(parameters())]));
      const value = table(parsed.value.CameraMovementDate)[0];
      const position = value.value.positionData.value;
      const rotation = value.value.rotationData.value;
      assert.equal(value.value.cameraName.value, "镜头 A");
      assert.equal(position.type.value, "自定义位置模式");
      assert.equal(position.snapToTarget.value, "True");
      assert.equal(position.orbitRot.value, "10,-20,30");
      assert.equal(position.orbitRadius.value, "2.75");
      assert.equal(position.slot.itemCount, 2);
      assert.deepEqual(Object.keys(position.slot.value[0].value), ["space", "pointType", "vector3", "guid", "entity", "attachmentPoint", "offset", "requiresClientPos"]);
      assert.equal(position.slot.value[0].value.vector3.value, "-160,900,0.125");
      assert.equal(position.slot.value[0].value.guid.value, "18446744073709551615");
      assert.equal(position.slot.value[0].value.entity.value, "主角实体");
      assert.equal(position.slot.value[0].value.requiresClientPos.value, "True");
      assert.equal(position.slot.value[1].value.entity.value, "第二个目标");
      assert.equal(rotation.slot.value[0].value.pointType.value, "look-at");
      assert.equal(rotation.snapToTarget.value, "False");
    });

    test("Timer alone controls start and Select shares the same 2.9-second bucket", () => {
      const source = project([camera(parameters())]);
      source.dialogue.nodes.group.dialogue.advanceMode = "None";
      source.dialogue.nodes.group.select = { id: "select", style: "Default_UI", startTime: 2.9, continueDelayTime: 0.5, options: [{ id: "a", content: "选项 A", icon: 123 }, { id: "b", content: "选项 B", icon: 456 }] };
      const { parsed } = exported(source);
      const group = table(parsed.value.ActionGroup)[0];
      assert.deepEqual(group.value.Timer.value.map((entry) => [entry.key.value, entry.value.value]), [["0", "0.00"], ["1", "2.90"]]);
      const actions = group.value.ActionClip.value[1].value.value;
      assert.deepEqual(actions.map((action) => action.value.actionType.value), ["NOLOC_DIALOG_SELECT", "NOLOC_CAMERA"]);
      assert.deepEqual(actions[1].value.stringParams.value, ["0"]);
      assert.deepEqual(actions[1].value.intParams.value, []);
      assert.equal(actions[1].value.duration.value, "1.25");
      assert.equal(Object.hasOwn(table(parsed.value.CameraMovementDate)[0].value, "delay"), false);
      const selection = table(parsed.value.DialogueSelectData)[0];
      assert.deepEqual(selection.value.content.value, ["选项 A", "选项 B"]);
      assert.deepEqual(selection.value.icons.value, ["123", "456"]);
      assert.equal(table(parsed.value.DialogueDate)[0].value.continueDelay.value, "-1.00");
    });

    test("Custom IDs replace root, nested structs, lists and dictionary definitions", () => {
      const source = project([camera(parameters())]);
      const defaults = createDefaultQxqyStructIds();
      source.exportSettings.qxqyStructIds = Object.fromEntries(Object.keys(defaults).map((key, index) => [key, String(2077936100 + index)]));
      const before = JSON.stringify(require(path.join(rootDirectory, "src/assets/DSFGStudio/1077936158演出.json")));
      const { result, parsed } = exported(source);
      const actualIds = new Set();
      function walk(value) {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (key === "structId" || key === "value_structId") actualIds.add(child);
          else walk(child);
        }
      }
      walk(result.value);
      for (const actual of actualIds) assert.ok(Object.values(source.exportSettings.qxqyStructIds).includes(actual));
      for (const original of Object.values(defaults)) assert.equal(actualIds.has(original), false);
      const cameraValue = table(parsed.value.CameraMovementDate)[0];
      assert.equal(cameraValue.value.positionData.structId, source.exportSettings.qxqyStructIds.cameraPosition);
      assert.equal(cameraValue.value.rotationData.structId, source.exportSettings.qxqyStructIds.cameraRotation);
      assert.equal(cameraValue.value.positionData.value.slot.value[0].structId, source.exportSettings.qxqyStructIds.cameraSlot);
      assert.equal(JSON.stringify(require(path.join(rootDirectory, "src/assets/DSFGStudio/1077936158演出.json"))), before);
    });

    test("Existing ID settings get the three new default IDs", () => {
      const ids = normalizeQxqyStructIds({ camera: "999" });
      assert.equal(ids.camera, "999");
      assert.equal(ids.cameraPosition, "1077936162");
      assert.equal(ids.cameraRotation, "1077936163");
      assert.equal(ids.cameraSlot, "1077936164");
      assert.equal(Object.keys(ids).length, 9);
    });

    for (const field of ["positionData", "rotationData"]) {
      test(`${field} accepts 100 slots and rejects 101 without truncation`, () => {
        const properties = parameters();
        properties[field].slot = Array.from({ length: 100 }, (_, index) => slot({ entity: String(index) }));
        const { parsed } = exported(project([camera(properties)]));
        assert.equal(table(parsed.value.CameraMovementDate)[0].value[field].value.slot.itemCount, 100);
        properties[field].slot.push(slot());
        assert.throws(() => exportQxqyPerformance(project([camera(properties)])), /101 项.*最多支持 100 项/);
      });
    }

    test("Invalid typed fields produce contextual errors", () => {
      for (const [field, invalid, expected] of [["vector3", "1,NaN,3", /vector3.*Vector3/], ["space", 2147483648, /space.*Int32/], ["guid", 18446744073709551615, /guid.*Guid/], ["requiresClientPos", "yes", /requiresClientPos.*Bool/]]) {
        const properties = parameters();
        properties.positionData.slot[0][field] = invalid;
        assert.throws(() => exportQxqyPerformance(project([camera(properties)])), expected);
      }
    });

    test("110 camera clips use 100/10 table chunks and retain global indices", () => {
      const source = project(Array.from({ length: 110 }, (_, index) => ({ ...camera({ cameraName: String(index) }, index), startTime: index / 10 })));
      const { parsed } = exported(source);
      const chunks = parsed.value.CameraMovementDate.value;
      assert.deepEqual(chunks.map((entry) => [entry.key.value, entry.value.itemCount]), [["0", 100], ["1", 10]]);
      assert.equal(chunks[1].value.value[9].value.cameraName.value, "109");
      const actions = table(table(parsed.value.ActionGroup)[0].value.ActionClip).filter((action) => action.value.actionType.value === "NOLOC_CAMERA");
      assert.deepEqual(actions[109].value.stringParams.value, ["109"]);
    });

    test("Disabled camera components and unmapped legacy fields cannot leak into the new struct", () => {
      const clip = camera(parameters());
      clip.components[0].enabled = false;
      clip.components.push({ id: "legacy", templateId: "custom.data", name: "Legacy", enabled: true, properties: { start_pos: "999,999,999", blendDuration: 12 } });
      const { parsed } = exported(project([clip]));
      const value = table(parsed.value.CameraMovementDate)[0];
      assert.equal(value.value.cameraName.value, "");
      assert.equal(value.value.positionData.value.slot.itemCount, 0);
      assert.equal(Object.hasOwn(value.value, "start_pos"), false);
    });

    test("Dialogue style, speaker, contents, delay and integer parameters remain unchanged", () => {
      const { parsed } = exported(project());
      const dialogue = table(parsed.value.DialogueDate)[0].value;
      assert.equal(dialogue.style.value, "Default_UI");
      assert.equal(dialogue.talker.value, "测试角色");
      assert.equal(dialogue.content.value, "测试台词");
      assert.equal(dialogue.subtitle.value, "副标题");
      assert.equal(dialogue.continueDelay.value, "0.50");
      assert.deepEqual(dialogue.prams.value, ["42"]);
    });
    console.log(`\n${passed} DSFG Camera export checks passed.`);
  } finally {
    Module._load = originalLoad;
    if (originalTypescriptExtension) Module._extensions[".ts"] = originalTypescriptExtension;
    else delete Module._extensions[".ts"];
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
