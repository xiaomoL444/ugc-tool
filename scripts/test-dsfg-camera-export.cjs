/* Run with: node scripts/test-dsfg-camera-export.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const vm = require("node:vm");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");

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
    const { importQxqyPerformance } = require(path.join(editorDirectory, "utils/qxqyPerformanceImporter.ts"));
    const { createDialogueClip } = require(path.join(editorDirectory, "utils/dialogueProject.ts"));
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
      CAMERA_VIEWPOINT_SLOT_PROPERTIES,
      normalizeCameraProperties,
    } = require(path.join(editorDirectory, "config/cameraClip.ts"));
    const { createClipComponent } = require(path.join(editorDirectory, "config/clipComponentRegistry.ts"));
    const { createClipPropertyValues, isClipPropertyVisible, getClipListLimits, getClipNestedProperties, updateClipStructField } = require(path.join(editorDirectory, "utils/clipProperties.ts"));
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
              dialogue: { id: "dialog", style: "NOLOC_Default", speaker: "测试角色", content: "测试台词", subtitle: "副标题", startTime: 0, continueDelayTime: 0.5, advanceMode: "PlayerInput", nodeGraphEvent: ["42"] },
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
      positionData: { type: "自定义位置模式", slot: [slot(), slot({ entity: "第二个目标", guid: "2" })], snapToTarget: true, orbitRotStart: "10,-20,30", orbitRotEnd: "40,50,-60", orbitRadius: 2.75 },
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
      expected.cameraName = "NOLOC_Default";
      expected.positionData.type = "NOLOC_Fixed";
      expected.positionData.slot = [createClipPropertyValues(CAMERA_SLOT_PROPERTIES)];
      expected.rotationData.type = "NOLOC_Fixed";
      expected.rotationData.slot = [createClipPropertyValues(CAMERA_SLOT_PROPERTIES)];
      const first = createClipComponent("camera.shot");
      const second = createClipComponent("camera.shot");
      assert.deepEqual(first.properties, expected);
      assert.deepEqual(createClipPropertyValues(CAMERA_SLOT_PROPERTIES), { ...plain(workspace.createDefault(ids.cameraSlot)), pointType: "NOLOC_Vector3", attachmentPoint: "GI_RootNode" });
      first.properties.positionData.slot.push(createClipPropertyValues(CAMERA_SLOT_PROPERTIES));
      first.properties.rotationData.type = "changed";
      assert.deepEqual(second.properties, expected);
      assert.equal(first.properties.rotationData.slot.length, 1);
    });

    test("Optional viewpoint preserves its draft, exports empty when off, and keeps legacy cameras enabled", () => {
      const component = createClipComponent('camera.shot');
      assert.equal(component.cameraViewpointEnabled, false);
      component.properties.rotationData = { type: 'NOLOC_LookAt', slot: [slot()], snapToTarget: true };
      const clip = camera();
      clip.components = [component];
      let decoded = decodeDialogueProject(encodeDialogueProject(project([clip])));
      let restored = decoded.dialogue.nodes.group.lines[0].clips[0].components[0];
      assert.equal(restored.cameraViewpointEnabled, false);
      assert.deepEqual(restored.properties.rotationData, component.properties.rotationData);
      let output = table(exported(decoded).parsed.value.CameraMovementData)[0].value;
      assert.equal(output.positionData.value.type.value, 'NOLOC_Fixed');
      assert.equal(output.positionData.value.slot.itemCount, 1);
      assert.equal(output.rotationData.value.type.value, '');
      assert.equal(output.rotationData.value.slot.itemCount, 0);
      assert.equal(output.rotationData.value.snapToTarget.value, 'False');
      restored.cameraViewpointEnabled = true;
      decoded = decodeDialogueProject(encodeDialogueProject(decoded));
      output = table(exported(decoded).parsed.value.CameraMovementData)[0].value;
      assert.equal(output.rotationData.value.type.value, 'NOLOC_LookAt');
      assert.equal(output.rotationData.value.slot.itemCount, 1);
      assert.equal(output.rotationData.value.snapToTarget.value, 'True');
      delete component.cameraViewpointEnabled;
      output = table(exported(decodeDialogueProject(encodeDialogueProject(project([clip])))).parsed.value.CameraMovementData)[0].value;
      assert.equal(output.rotationData.value.type.value, 'NOLOC_LookAt');
    });

    test("Camera selectors have explicit typed choices for position and rotation", () => {
      const positionType = CAMERA_POSITION_PROPERTIES.find((property) => property.key === "type");
      assert.equal(positionType.type, "select");
      assert.equal(positionType.defaultValue, "NOLOC_Fixed");
      assert.deepEqual(positionType.options.map((option) => option.value), ["NOLOC_Fixed", "NOLOC_Linear", "NOLOC_Follow", "NOLOC_Orbit"]);
      assert.deepEqual(positionType.options.map(option => option.label), ['固定位置', '线性移动', '跟随', '环绕']);
      const space = CAMERA_SLOT_PROPERTIES.find((property) => property.key === "space");
      assert.equal(space.type, "select");
      assert.equal(space.defaultValue, 0);
      assert.deepEqual(space.options.map((option) => option.value), [0, 1]);
      assert.ok(space.options[0].label.includes("Local"));
      assert.ok(space.options[1].label.includes("World"));
      const pointType = CAMERA_SLOT_PROPERTIES.find((property) => property.key === "pointType");
      assert.equal(pointType.type, "select");
      assert.equal(pointType.defaultValue, "NOLOC_Vector3");
      assert.deepEqual(pointType.options.map((option) => option.value), ["NOLOC_Vector3", "NOLOC_Guid", "NOLOC_Entity"]);
      const rotationType = CAMERA_ROTATION_PROPERTIES.find((property) => property.key === "type");
      assert.equal(rotationType.type, "select");
      assert.equal(rotationType.defaultValue, "NOLOC_Fixed");
      assert.deepEqual(rotationType.options.map(option => option.value), ["NOLOC_Fixed", "NOLOC_Linear", "NOLOC_LookAt"]);
      assert.deepEqual(rotationType.options.map(option => option.label), ['固定角度', '线性移动', '固定视点位置']);
      const name = CAMERA_CLIP_COMPONENT_TEMPLATE.properties.find((property) => property.key === "cameraName");
      assert.equal(name.type, "string");
      assert.equal(name.defaultValue, "NOLOC_Default");
      for (const properties of [CAMERA_POSITION_PROPERTIES, CAMERA_ROTATION_PROPERTIES]) {
        const fields = properties.find((property) => property.key === "slot").properties;
        if (properties === CAMERA_POSITION_PROPERTIES) {
          assert.deepEqual(fields.map(field => field.key), CAMERA_SLOT_PROPERTIES.map(field => field.key));
          assert.deepEqual(fields.find(field => field.key === 'space').visibleWhen, { key: 'pointType', values: ['NOLOC_Guid', 'NOLOC_Entity'] });
          const orbitFields = getClipNestedProperties(properties.find(field => field.key === 'slot'), { type: 'NOLOC_Orbit' });
          assert.deepEqual(orbitFields.find(field => field.key === 'space').visibleWhen, { key: 'pointType', values: ['NOLOC_Guid', 'NOLOC_Entity'] });
          assert.equal(space.visibleWhen, undefined);
        } else {
          assert.equal(fields, CAMERA_VIEWPOINT_SLOT_PROPERTIES);
          assert.deepEqual(fields.find(field => field.key === 'space').visibleWhen, { key: 'pointType', values: ['NOLOC_Rot'] });
          assert.equal(isClipPropertyVisible(fields.find(field => field.key === 'space'), { pointType: 'NOLOC_Vector3' }), false);
        }
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
        assert.equal(table(parsed.value.CameraMovementData)[0].value.positionData.value.slot.value[0].value.space.value, String(selected.value));
      }
    });

    test("Viewpoint Rot uses the vector field and preserves its type and values through codec and export", () => {
      assert.deepEqual(CAMERA_VIEWPOINT_SLOT_PROPERTIES.find(field => field.key === 'pointType').options.map(item => item.value), ['NOLOC_Vector3', 'NOLOC_Rot']);
      assert.ok(!CAMERA_SLOT_PROPERTIES.find(field => field.key === 'pointType').options.some(item => item.value === 'NOLOC_Rot'));
      const target = createClipPropertyValues(CAMERA_VIEWPOINT_SLOT_PROPERTIES, slot({ pointType: 'NOLOC_Rot', vector3: '10,20,-30' }));
      assert.deepEqual(CAMERA_VIEWPOINT_SLOT_PROPERTIES.filter(field => isClipPropertyVisible(field, target)).map(field => field.key), ['space', 'pointType', 'vector3']);
      const decoded = decodeDialogueProject(encodeDialogueProject(project([camera({ rotationData: { type: 'NOLOC_Fixed', slot: [target], snapToTarget: false } })])));
      const restored = decoded.dialogue.nodes.group.lines[0].clips[0].components[0].properties.rotationData.slot[0];
      assert.deepEqual(restored, target);
      const output = table(exported(decoded).parsed.value.CameraMovementData)[0].value.rotationData.value.slot.value[0].value;
      assert.equal(output.pointType.value, 'NOLOC_Rot');
      assert.equal(output.vector3.value, '10,20,-30');
      assert.deepEqual(Object.keys(output), CAMERA_SLOT_PROPERTIES.map(field => field.key));
      const switched = updateClipStructField(CAMERA_VIEWPOINT_SLOT_PROPERTIES, target, 'pointType', 'NOLOC_Entity');
      assert.equal(switched.vector3, '10,20,-30');
      assert.equal(switched.entity, target.entity);
    });

    test("Only fixed viewpoint offers Rot; mode changes keep hidden target fields", () => {
      const definition = CAMERA_ROTATION_PROPERTIES.find(field => field.key === 'slot');
      const choices = mode => getClipNestedProperties(definition, { type: mode }).find(field => field.key === 'pointType').options.map(option => option.value);
      assert.deepEqual(choices('NOLOC_Fixed'), ['NOLOC_Vector3', 'NOLOC_Rot']);
      assert.deepEqual(choices('NOLOC_Linear'), ['NOLOC_Vector3', 'NOLOC_Guid', 'NOLOC_Entity']);
      assert.deepEqual(choices('NOLOC_LookAt'), ['NOLOC_Vector3', 'NOLOC_Guid', 'NOLOC_Entity']);
      for (const pointType of ['NOLOC_Guid', 'NOLOC_Entity', 'NOLOC_Vector3', 'NOLOC_Rot']) {
        const original = createClipPropertyValues(CAMERA_ROTATION_PROPERTIES, { type: 'NOLOC_LookAt', slot: [slot({ pointType, vector3: '1,2,3' })] });
        const updated = updateClipStructField(CAMERA_ROTATION_PROPERTIES, original, 'type', 'NOLOC_Fixed');
        assert.equal(updated.slot[0].pointType, pointType);
        for (const key of ['vector3', 'guid', 'entity', 'attachmentPoint', 'offset']) assert.equal(updated.slot[0][key], original.slot[0][key]);
        assert.equal(original.slot[0].pointType, pointType);
      }
      assert.equal(createClipPropertyValues(CAMERA_ROTATION_PROPERTIES, { type: 'NOLOC_Fixed', slot: [slot({ pointType: 'NOLOC_Entity' })] }).slot[0].pointType, 'NOLOC_Entity', 'Reading older files must not rewrite targets');
      for (const mode of ['NOLOC_Linear', 'NOLOC_LookAt']) {
        const original = createClipPropertyValues(CAMERA_ROTATION_PROPERTIES, { type: 'NOLOC_Fixed', slot: [slot({ pointType: 'NOLOC_Rot', vector3: '1,2,3' })] });
        const updated = updateClipStructField(CAMERA_ROTATION_PROPERTIES, original, 'type', mode);
        assert.equal(updated.slot[0].pointType, 'NOLOC_Vector3');
        assert.equal(updated.slot[0].vector3, '1,2,3');
        assert.equal(updated.slot[0].guid, original.slot[0].guid);
        assert.equal(original.slot[0].pointType, 'NOLOC_Rot');
      }
      const position = CAMERA_POSITION_PROPERTIES.find(field => field.key === 'slot');
      assert.deepEqual(getClipNestedProperties(position, { type: 'NOLOC_Fixed' }).find(field => field.key === 'pointType').options.map(option => option.value), ['NOLOC_Vector3', 'NOLOC_Guid', 'NOLOC_Entity']);
    });

    test("Legacy camera enums migrate on reopen and export without changing points or custom values", () => {
      for (const [kind, modes] of [['positionData', ['Fixed', 'Linear', 'Follow', 'Orbit']], ['rotationData', ['Fixed', 'Linear', 'LookAt']]]) {
        for (const mode of modes) {
          const types = kind === 'positionData' ? ['Vector3', 'Guid', 'Entity'] : ['Vector3', 'Guid', 'Entity', 'Rot'];
          const properties = { [kind]: { type: mode, slot: types.map(pointType => slot({ pointType })), customDraft: { note: 'keep' } } };
          const before = structuredClone(properties);
          const source = project([camera(properties)]);
          const restored = decodeDialogueProject(encodeDialogueProject(source)).dialogue.nodes.group.lines[0].clips[0].components[0].properties;
          assert.equal(restored[kind].type, 'NOLOC_' + mode);
          assert.deepEqual(restored[kind].slot, before[kind].slot.map(point => ({ ...point, pointType: 'NOLOC_' + point.pointType })));
          assert.deepEqual(restored[kind].customDraft, before[kind].customDraft);
          const output = table(exported(source).parsed.value.CameraMovementData)[0].value[kind].value;
          assert.equal(output.type.value, 'NOLOC_' + mode);
          assert.deepEqual(output.slot.value.map(point => point.value.pointType.value), types.map(type => 'NOLOC_' + type));
          assert.deepEqual(properties, before);
          const normalized = normalizeCameraProperties(properties);
          assert.deepEqual(normalizeCameraProperties(normalized), normalized);
        }
      }
      assert.deepEqual(normalizeCameraProperties({ positionData: { type: '', slot: [{ pointType: 'future' }] }, metadata: 'Linear' }), { positionData: { type: '', slot: [{ pointType: 'future' }] }, metadata: 'Linear' });
    });

    test("Actual motion editor prepends optional start, preserves the endpoint, and exports start before end", () => {
      const filename = path.join(editorDirectory, 'components/clip-editors/CameraMotionEditor.vue');
      const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
      assert.deepEqual(errors, []);
      const script = compileScript(descriptor, { id: 'camera-motion-test' });
      assert.deepEqual(compileTemplate({ filename, id: 'camera-motion-test', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
      assert.ok(descriptor.template.content.indexOf('添加起点（若不填写起点则获取当前位置）') < descriptor.template.content.indexOf('<article'));
      const ast = ts.createSourceFile(filename + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const handlers = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join('\n');
      for (const kind of ['position', 'rotation']) {
        const definitions = kind === 'position' ? CAMERA_POSITION_PROPERTIES : CAMERA_ROTATION_PROPERTIES;
        const fields = getClipNestedProperties(definitions.find(field => field.key === 'slot'), { type: 'NOLOC_Linear' });
        assert.equal(fields.find(field => field.key === 'guid').entityPresetField, 'guid');
        assert.equal(fields.find(field => field.key === 'entity').entityPresetField, 'entityQuery');
        const endpoint = slot({ pointType: 'NOLOC_Guid', guid: '18446744073709551615' });
        const value = createClipPropertyValues(definitions, { type: 'NOLOC_Linear', slot: [endpoint] });
        const context = {
          props: { kind }, definitions: { value: definitions }, value: { value }, mode: { value: value.type }, slots: { value: value.slot },
          limits: { value: { min: 1, max: 2 } }, slotFields: { value: getClipNestedProperties(definitions.find(field => field.key === 'slot'), value) },
          createClipPropertyValues, updateClipStructField,
          emit(event, next) { assert.equal(event, 'update:modelValue'); context.value.value = next; context.slots.value = next.slot; },
        };
        vm.createContext(context);
        vm.runInContext(ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
        assert.equal(context.slotName(0), '终点');
        context.addSlot();
        assert.equal(context.slotName(0), '起点'); assert.equal(context.slotName(1), '终点');
        assert.deepEqual(JSON.parse(JSON.stringify(context.slots.value[1])), endpoint);
        context.updateSlot(0, 'vector3', '1,2,3');
        if (kind === 'position') {
          assert.equal(isClipPropertyVisible(fields.find(field => field.key === 'offset'), context.slots.value[0]), true);
          context.updateSlot(0, 'offset', '4,-5,6');
        }
        context.addSlot(); assert.equal(context.slots.value.length, 2);
        const field = kind === 'position' ? 'positionData' : 'rotationData';
        const restored = decodeDialogueProject(encodeDialogueProject(project([camera({ [field]: context.value.value })])));
        const output = table(exported(restored).parsed.value.CameraMovementData)[0].value[field].value;
        assert.equal(output.type.value, 'NOLOC_Linear');
        assert.equal(output.slot.value[0].value.vector3.value, '1,2,3');
        if (kind === 'position') assert.equal(output.slot.value[0].value.offset.value, '4,-5,6');
        assert.equal(output.slot.value[1].value.guid.value, endpoint.guid);
        context.swapSlots(); assert.equal(context.slots.value[0].guid, endpoint.guid);
        context.swapSlots(); context.removeSlot(0);
        assert.equal(context.slotName(0), '终点');
        assert.deepEqual(JSON.parse(JSON.stringify(context.slots.value)), [endpoint]);
        context.removeSlot(0); assert.equal(context.slots.value.length, 1);
      }
    });

    test("Vector inputs accept finite floats and restore saved values after invalid or incomplete edits", () => {
      const filename = path.join(editorDirectory, 'components/clip-editors/ClipPropertyEditor.vue');
      const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
      const script = compileScript(descriptor, { id: 'vector-input-test' });
      assert.deepEqual(compileTemplate({ filename, id: 'vector-input-test', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
      const ast = ts.createSourceFile(filename + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const handlers = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join('\n');
      const context = { props: { property: {} }, vectorParts: { value: ['0', '2', '3'] }, vectorDrafts: { value: {} },
        emit(event, value) { assert.equal(event, 'update:modelValue'); context.vectorParts.value = value.split(','); },
      };
      vm.createContext(context);
      vm.runInContext(ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
      for (const text of ['-1.25', '0', '0.123456', '1e-5']) {
        const target = { value: text, valueAsNumber: Number(text) };
        context.updateVector(0, { target });
        assert.equal(context.vectorParts.value.join(','), `${Number(text)},2,3`);
      }
      for (const text of ['-', '-0', '-0.', '-0.5', '-0.56']) {
        const target = { value: text };
        context.updateVector(0, { target });
        assert.equal(context.vectorDrafts.value[0], text);
        assert.equal(target.value, text);
      }
      assert.equal(context.vectorParts.value.join(','), '-0.56,2,3');
      const finished = { value: '-0.560' };
      context.finishVectorInput(0, { target: finished });
      assert.equal(finished.value, '-0.56');
      assert.equal(context.vectorDrafts.value[0], undefined);
      for (const text of ['', '-', 'abc', '1e', '1e400', '3.5e38', 'Infinity']) {
        const before = context.vectorParts.value.join(',');
        const target = { value: text, valueAsNumber: text === '' ? NaN : Number(text) };
        context.updateVector(0, { target });
        assert.equal(context.vectorParts.value.join(','), before);
        context.finishVectorInput(0, { target });
        assert.equal(target.value, context.vectorParts.value[0]);
      }
      for (const invalid of ['1,NaN,3', '1,3.5e38,3', '1,Infinity,3', '1,,3']) {
        assert.throws(() => exported(project([camera({ positionData: { slot: [slot({ vector3: invalid })] } })])), /vector3.*Vector3/);
      }
    });

    test("Slot visibility follows point type and compares condition values without coercion", () => {
      const common = ["space", "pointType"];
      for (const [pointType, expected] of [
        ["NOLOC_Vector3", [...common, "vector3"]],
        ["NOLOC_Guid", [...common, "guid", "attachmentPoint", "offset", "requiresClientPos"]],
        ["NOLOC_Entity", [...common, "entity", "attachmentPoint", "offset", "requiresClientPos"]],
      ]) {
        const values = { ...slot(), pointType };
        assert.deepEqual(CAMERA_SLOT_PROPERTIES.filter((property) => isClipPropertyVisible(property, values)).map((property) => property.key), expected);
      }
      const conditional = { key: "test", label: "test", type: "string", defaultValue: "", visibleWhen: { key: "space", values: [1] } };
      assert.deepEqual(CAMERA_VIEWPOINT_SLOT_PROPERTIES.filter(property => isClipPropertyVisible(property, { pointType: 'NOLOC_Guid' })).map(property => property.key), ['pointType']);
      assert.equal(isClipPropertyVisible(conditional, { space: 1 }), true);
      assert.equal(isClipPropertyVisible(conditional, { space: "1" }), false);
      assert.equal(isClipPropertyVisible(conditional, {}), false);
      assert.equal(isClipPropertyVisible({ ...conditional, visibleWhen: undefined }, {}), true);
    });

    test("Camera position mode controls Orbit and Follow fields and Slot bounds", () => {
      const slotDefinition = CAMERA_POSITION_PROPERTIES.find(property => property.key === 'slot');
      for (const [type, fields, max] of [
        ['NOLOC_Fixed', ['type', 'slot'], 1],
        ['NOLOC_Linear', ['type', 'slot'], 2],
        ['NOLOC_Follow', ['type', 'slot', 'snapToTarget'], 1],
        ['NOLOC_Orbit', ['type', 'slot', 'orbitRotStart', 'orbitRotEnd', 'orbitRadius'], 1],
      ]) {
        const value = createClipPropertyValues(CAMERA_POSITION_PROPERTIES, { type });
        assert.equal(value.slot.length, 1);
        assert.deepEqual(CAMERA_POSITION_PROPERTIES.filter(property => isClipPropertyVisible(property, value)).map(property => property.key), fields);
        assert.deepEqual(getClipListLimits(slotDefinition, value), { min: 1, max });
        const slotFields = getClipNestedProperties(slotDefinition, value);
        for (const pointType of ['NOLOC_Vector3', 'NOLOC_Guid', 'NOLOC_Entity']) {
          assert.equal(isClipPropertyVisible(slotFields.find(field => field.key === 'vector3'), { pointType }), type !== 'NOLOC_Follow' && pointType === 'NOLOC_Vector3', `${type}/${pointType}: Vector3 visibility`);
          assert.equal(isClipPropertyVisible(slotFields.find(field => field.key === 'offset'), { pointType }), type === 'NOLOC_Linear' || pointType !== 'NOLOC_Vector3', `${type}/${pointType}: offset visibility`);
        }
      }
      assert.deepEqual(getClipListLimits(CAMERA_ROTATION_PROPERTIES.find(property => property.key === 'slot')), { min: 1, max: 1 });
    });

    test("Rotation modes restrict Slots and show snapToTarget only for LookAt", () => {
      const definition = CAMERA_ROTATION_PROPERTIES.find(property => property.key === 'slot');
      for (const type of ['NOLOC_Fixed', 'NOLOC_Linear', 'NOLOC_LookAt']) {
        const values = createClipPropertyValues(CAMERA_ROTATION_PROPERTIES, { type });
        assert.equal(values.slot.length, 1);
        assert.deepEqual(getClipListLimits(definition, values), { min: 1, max: type === 'NOLOC_Linear' ? 2 : 1 });
        assert.deepEqual(CAMERA_ROTATION_PROPERTIES.filter(property => isClipPropertyVisible(property, values)).map(property => property.key), type === 'NOLOC_LookAt' ? ['type', 'slot', 'snapToTarget'] : ['type', 'slot']);
      }
      const original = createClipPropertyValues(CAMERA_ROTATION_PROPERTIES, { type: 'NOLOC_Linear', slot: [slot({ entity: 'first' }), slot({ entity: 'second' })], snapToTarget: true });
      for (const type of ['NOLOC_Fixed', 'NOLOC_Linear', 'NOLOC_LookAt']) {
        const updated = updateClipStructField(CAMERA_ROTATION_PROPERTIES, original, 'type', type);
        assert.deepEqual(updated.slot, original.slot.slice(0, type === 'NOLOC_Linear' ? 2 : 1));
        assert.equal(updated.snapToTarget, true);
        const decoded = decodeDialogueProject(encodeDialogueProject(project([camera({ rotationData: updated })])));
        const restored = decoded.dialogue.nodes.group.lines[0].clips[0].components[0].properties;
        assert.deepEqual(restored.rotationData, updated);
        assert.equal(restored.positionData.type, 'NOLOC_Fixed');
        assert.equal(restored.positionData.slot.length, 1);
        const { parsed } = exported(decoded);
        assert.equal(table(parsed.value.CameraMovementData)[0].value.rotationData.value.slot.itemCount, updated.slot.length);
      }
      assert.equal(original.slot.length, 2);
      assert.equal(createClipPropertyValues(CAMERA_ROTATION_PROPERTIES, { ...original, type: 'NOLOC_Fixed' }).slot.length, 2, 'Reading older files must preserve extra targets');
    });

    test("Reading explicit empty Slots preserves them; selecting a mode applies its minimum", () => {
      for (const definitions of [CAMERA_POSITION_PROPERTIES, CAMERA_ROTATION_PROPERTIES]) {
        const empty = createClipPropertyValues(definitions, { type: 'NOLOC_Linear', slot: [] });
        assert.deepEqual(empty.slot, []);
        const changed = updateClipStructField(definitions, empty, 'type', 'NOLOC_Fixed');
        assert.equal(changed.slot.length, 1);
        assert.equal(changed.slot[0].pointType, 'NOLOC_Vector3');
        assert.deepEqual(empty.slot, [], 'Editing must not mutate the saved source');
      }
      const followed = updateClipStructField(CAMERA_POSITION_PROPERTIES, { type: 'NOLOC_Fixed', slot: [] }, 'type', 'NOLOC_Follow');
      assert.equal(followed.slot[0].pointType, 'NOLOC_Guid');
    });

    test("Changing from Linear to single-Slot modes retains the first target and all hidden settings", () => {
      const original = createClipPropertyValues(CAMERA_POSITION_PROPERTIES, { type: 'NOLOC_Linear', slot: [slot({ entity: 'first' }), slot({ entity: 'second' })], snapToTarget: true, orbitRotStart: '10,20,30', orbitRadius: 6 });
      for (const type of ['NOLOC_Follow', 'NOLOC_Orbit', 'NOLOC_Fixed']) {
        const updated = updateClipStructField(CAMERA_POSITION_PROPERTIES, original, 'type', type);
        assert.deepEqual(updated.slot, [original.slot[0]]);
        assert.equal(updated.snapToTarget, true);
        assert.equal(updated.orbitRotStart, '10,20,30');
        assert.equal(updated.orbitRadius, 6);
        assert.equal(original.slot.length, 2);
        const roundtrip = decodeDialogueProject(encodeDialogueProject(project([camera({ positionData: updated })])));
        assert.deepEqual(roundtrip.dialogue.nodes.group.lines[0].clips[0].components[0].properties.positionData, updated);
      }
      const linear = updateClipStructField(CAMERA_POSITION_PROPERTIES, original, 'type', 'NOLOC_Linear');
      assert.equal(linear.slot.length, 2);
      const legacy = createClipPropertyValues(CAMERA_POSITION_PROPERTIES, { ...original, type: 'NOLOC_Fixed' });
      assert.equal(legacy.slot.length, 2, 'Reading legacy data preserves extra targets until an explicit mode change');
    });

    test("Switching point types hides fields without deleting them from codec or complete exports", () => {
      const properties = parameters();
      const selectedSlot = properties.positionData.slot[0];
      selectedSlot.customPreserved = { note: "keep hidden fields" };
      const original = structuredClone(selectedSlot);
      for (const pointType of ["NOLOC_Vector3", "NOLOC_Guid", "NOLOC_Entity", "NOLOC_Vector3"]) {
        selectedSlot.pointType = pointType;
        const beforeVisibility = JSON.stringify(properties);
        CAMERA_SLOT_PROPERTIES.filter((property) => isClipPropertyVisible(property, selectedSlot));
        assert.equal(JSON.stringify(properties), beforeVisibility);
        const restored = decodeDialogueProject(encodeDialogueProject(project([camera(properties)])));
        const restoredSlot = restored.dialogue.nodes.group.lines[0].clips[0].components[0].properties.positionData.slot[0];
        assert.deepEqual(restoredSlot, { ...original, pointType });
        const { parsed } = exported(restored);
        const value = table(parsed.value.CameraMovementData)[0].value.positionData.value.slot.value[0].value;
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
        const value = table(parsed.value.CameraMovementData)[0].value;
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
        assert.equal(properties.cameraName, "NOLOC_Default");
        const { parsed } = exported(decoded);
        const value = table(parsed.value.CameraMovementData)[0];
        assert.equal(value.value.cameraName.value, "NOLOC_Default");
        assert.equal(value.value.positionData.value.type.value, "NOLOC_Fixed");
        assert.equal(value.value.positionData.value.slot.itemCount, 1);
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
      assert.equal(properties.cameraName, "NOLOC_Default");
      assert.equal(properties.positionData.type, "NOLOC_Fixed");
      assert.equal(properties.positionData.snapToTarget, false);
      assert.equal(properties.positionData.orbitRadius, 0);
      assert.equal(properties.positionData.orbitRotStart, "0,0,0");
      assert.deepEqual(properties.positionData.slot.map((item) => item.entity), ["third", "first", "second"]);
      assert.equal(properties.positionData.slot[0].customKey, "keep");
      assert.equal(properties.positionData.slot[0].guid, "0");
      assert.equal(properties.positionData.slot[0].vector3, "0,0,0");
      assert.equal(properties.positionData.slot[1].guid, "9007199254740993");
      assert.equal(properties.positionData.slot[1].vector3, "1,2,3");
      assert.equal(properties.rotationData.type, "NOLOC_Fixed");
      assert.equal(properties.rotationData.snapToTarget, true);
      assert.equal(properties.rotationData.slot[0].attachmentPoint, "Head");
      assert.equal(properties.rotationData.slot[0].requiresClientPos, false);
      const { parsed } = exported(decoded);
      const slots = table(parsed.value.CameraMovementData)[0].value.positionData.value.slot.value;
      assert.deepEqual(slots.map((item) => item.value.entity.value), ["third", "first", "second"]);
      assert.deepEqual(decodeDialogueProject(encodeDialogueProject(decoded)).dialogue.nodes.group.lines[0].clips[0].components[0].properties, properties);
    });

    test("Legacy Orbit drafts retain position and old angle without guessing new start/end angles", () => {
      const source = project([camera({ positionData: { type: 'NOLOC_Orbit', slot: [slot({ vector3: '11,22,33' })], orbitRot: '44,55,66' } })]);
      const restored = decodeDialogueProject(encodeDialogueProject(source));
      const data = restored.dialogue.nodes.group.lines[0].clips[0].components[0].properties.positionData;
      assert.equal(data.slot[0].vector3, '11,22,33');
      assert.equal(data.orbitRot, '44,55,66');
      assert.equal(data.orbitRotStart, '0,0,0');
      assert.equal(data.orbitRotEnd, '0,0,0');
      const output = table(exported(restored).parsed.value.CameraMovementData)[0].value.positionData.value;
      assert.equal(output.orbitRot, undefined);
      assert.equal(output.slot.value[0].value.vector3.value, '11,22,33');
    });

    test("CameraClip embedded defaults and source field order", () => {
      const source = project();
      const { parsed, workspace } = exported(source);
      const value = table(parsed.value.CameraMovementData)[0];
      assert.deepEqual(Object.keys(value.value), ["duration", "positionData", "rotationData", "cameraName"]);
      assert.equal(value.value.duration.value, "1.25");
      assert.equal(value.value.cameraName.value, "");
      assert.equal(value.value.positionData.value.orbitRadius.value, "0.00");
      assert.deepEqual(Object.keys(value.value.positionData.value), ["type", "slot", "snapToTarget", "orbitRotStart", "orbitRotEnd", "orbitRadius"]);
      assert.equal(value.value.positionData.value.orbitRotEnd.value, "0,0,0");
      assert.equal(value.value.positionData.value.slot.itemCount, 0);
      assert.equal(value.value.rotationData.value.slot.itemCount, 0);
      const standalone = workspace.createDefault(source.exportSettings.qxqyStructIds.cameraPosition);
      assert.equal(standalone.value.orbitRadius.value, "2.00");
      assert.equal(standalone.value.slot.itemCount, 1);
      assert.equal(parsed.value.CameraMovementData.toParamNode().value.key_type, "Int32");
    });

    test("Nested position, rotation and ordered target slots preserve values", () => {
      const { parsed } = exported(project([camera(parameters())]));
      const value = table(parsed.value.CameraMovementData)[0];
      const position = value.value.positionData.value;
      const rotation = value.value.rotationData.value;
      assert.equal(value.value.cameraName.value, "镜头 A");
      assert.equal(position.type.value, "自定义位置模式");
      assert.equal(position.snapToTarget.value, "True");
      assert.equal(position.orbitRotStart.value, "10,-20,30");
      assert.equal(position.orbitRotEnd.value, "40,50,-60");
      assert.equal(position.orbitRot, undefined);
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
      assert.deepEqual(actions[1].value.stringParams.value, []);
      assert.deepEqual(actions[1].value.intParams.value, ["0"]);
      assert.equal(actions[1].value.intParams.toParamNode().param_type, "Int32List");
      assert.equal(actions[1].value.duration.value, "1.25");
      assert.equal(Object.hasOwn(table(parsed.value.CameraMovementData)[0].value, "delay"), false);
      const selection = table(parsed.value.DialogueSelectData)[0];
      assert.deepEqual(selection.value.content.value, ["选项 A", "选项 B"]);
      assert.deepEqual(selection.value.icons.value, ["123", "456"]);
      assert.equal(table(parsed.value.DialogueData)[0].value.continueDelay.value, "-1.00");
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
      const cameraValue = table(parsed.value.CameraMovementData)[0];
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
        assert.equal(table(parsed.value.CameraMovementData)[0].value[field].value.slot.itemCount, 100);
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
      const chunks = parsed.value.CameraMovementData.value;
      assert.equal(parsed.value.CameraMovementData.toParamNode().value.key_type, "Int32");
      assert.ok(chunks.every(chunk => chunk.key.toParamNode().param_type === "Int32"));
      assert.deepEqual(chunks.map((entry) => [entry.key.value, entry.value.itemCount]), [["0", 100], ["1", 10]]);
      assert.equal(chunks[1].value.value[9].value.cameraName.value, "109");
      const actions = table(table(parsed.value.ActionGroup)[0].value.ActionClip).filter((action) => action.value.actionType.value === "NOLOC_CAMERA");
      assert.deepEqual(actions.map(action => action.value.intParams.value), Array.from({ length: 110 }, (_, index) => [String(index)]));
      assert.ok(actions.every(action => action.value.stringParams.value.length === 0));
    });

    test("Disabled camera components and unmapped legacy fields cannot leak into the new struct", () => {
      const clip = camera(parameters());
      clip.components[0].enabled = false;
      clip.components.push({ id: "legacy", templateId: "custom.data", name: "Legacy", enabled: true, properties: { start_pos: "999,999,999", blendDuration: 12 } });
      const { parsed } = exported(project([clip]));
      const value = table(parsed.value.CameraMovementData)[0];
      assert.equal(value.value.cameraName.value, "");
      assert.equal(value.value.positionData.value.slot.itemCount, 0);
      assert.equal(Object.hasOwn(value.value, "start_pos"), false);
    });

    test("Dialogue style, speaker, contents, delay and integer parameters remain unchanged", () => {
      const { parsed } = exported(project());
      const dialogue = table(parsed.value.DialogueData)[0].value;
      assert.equal(dialogue.style.value, "NOLOC_Default");
      assert.equal(dialogue.talker.value, "测试角色");
      assert.equal(dialogue.content.value, "测试台词");
      assert.equal(dialogue.subtitle.value, "副标题");
      assert.equal(dialogue.continueDelay.value, "0.50");
      assert.deepEqual(dialogue.prams.value, ["42"]);
      assert.equal(dialogue.autoContinue.type, "Float");
      assert.equal(dialogue.autoContinue.value, "-1.00");
      assert.equal(Object.keys(dialogue).at(-1), "autoContinue");
    });
    test("Dialogue autoContinue defaults to -1 and survives saving and runtime round trips", () => {
      assert.equal(createDialogueClip().autoContinue, -1);
      assert.equal(decodeDialogueProject(encodeDialogueProject(project())).dialogue.nodes.group.dialogue.autoContinue, -1);
      for (const value of [-1, 0, 2.75, 10]) {
        const source = project([]);
        source.dialogue.nodes.group.dialogue.autoContinue = value;
        const saved = decodeDialogueProject(encodeDialogueProject(source));
        assert.equal(saved.dialogue.nodes.group.dialogue.autoContinue, value);
        const { result, parsed } = exported(saved);
        assert.equal(table(parsed.value.DialogueData)[0].value.autoContinue.value, value.toFixed(2));
        const imported = importQxqyPerformance(result.json).project;
        assert.equal(Object.values(imported.dialogue.nodes)[0].dialogue.autoContinue, value);
        assert.equal(table(exported(imported).parsed.value.DialogueData)[0].value.autoContinue.value, value.toFixed(2));
      }
      for (const value of [null, "", "invalid", Infinity, NaN]) {
        const source = project([]);
        source.dialogue.nodes.group.dialogue.autoContinue = value;
        assert.equal(decodeDialogueProject(source).dialogue.nodes.group.dialogue.autoContinue, -1);
      }
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
