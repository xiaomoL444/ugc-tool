/* Run with: node scripts/test-dsfg-quest-export.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

async function main() {
  const variableLibrary = await import("miliastra-variable");
  const root = path.resolve(__dirname, "..");
  const questDirectory = path.join(root, "src/views/DSFGStudio/components/QuestEditor");
  const assetDirectory = path.join(root, "src/assets/DSFGStudio/Quest");
  const originalLoad = Module._load;
  const originalExtension = Module._extensions[".ts"];
  Module._load = function (request, parent, isMain) {
    if (request === "miliastra-variable") return variableLibrary;
    return originalLoad.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, isMain);
  };
  Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
  }).outputText, filename);
  try {
    const { createQuestProject, createQuestChapter, createQuestMain, createQuestSub, removeQuestSubQuests, validateQuestProject, encodeQuestProject, decodeQuestProject } = require(path.join(questDirectory, "questProject.ts"));
    const { exportQuestVariables, createQuestStructWorkspace } = require(path.join(questDirectory, "questExporter.ts"));
    let passed = 0;
    function test(name, callback) { callback(); passed++; console.log(`PASS ${name}`); }
    function source(count = 1) {
      const project = createQuestProject();
      const chapter = createQuestChapter(project);
      const main = createQuestMain(project, chapter.id);
      if (count) {
        const first = createQuestSub(project, main.id);
        project.subQuests = Array.from({ length: count }, (_, id) => ({ ...first, id, title: `子任务 ${id}`, nextQuestIds: [...first.nextQuestIds], investigationPoint: { ...first.investigationPoint } }));
      }
      return project;
    }
    function exported(project) {
      const result = exportQuestVariables(project);
      const workspace = createQuestStructWorkspace(project.structIds);
      const parsed = result.files.map((file) => {
        assert.deepEqual(JSON.parse(file.json), file.value);
        const value = workspace.parse(file.value);
        assert.deepEqual(value.issues, []);
        return value;
      });
      // 自身 id 必须与字典中的完整键一致，而不是父 ID、数组位置或桶内偏移。
      const assertOwnIds = (dictionary) => dictionary.value.forEach((entry) => {
        assert.equal(entry.value.value.id.type, "Int32");
        assert.equal(entry.value.value.id.value, entry.key.value);
        assert.equal(Object.keys(entry.value.value)[0], "id");
      });
      assertOwnIds(parsed[0]); assertOwnIds(parsed[1]);
      parsed[2].value.forEach((entry) => assertOwnIds(entry.value.value["子任务字典"]));
      return { result, chapters: parsed[0], mains: parsed[1], subs: parsed[2] };
    }
    const values = (dict) => dict.value.map((entry) => entry.value);
    const keys = (dict) => dict.value.map((entry) => Number(entry.key.value));

    test("empty project exports precisely three empty source-shaped NOLOC dictionaries", () => {
      const project = createQuestProject();
      const result = exportQuestVariables(project);
      assert.deepEqual(result.files.map((file) => file.filename), ["NOLOC_章节配置.json", "NOLOC_主任务配置.json", "NOLOC_子任务.json"]);
      for (const file of result.files) {
        assert.equal(file.value.type, "Dict"); assert.equal(file.value.key_type, "Int32"); assert.equal(file.value.value_type, "Struct");
        assert.deepEqual(file.value.value, []);
      }
      assert.equal(result.files[0].value.value_structId, project.structIds.chapter);
      assert.equal(result.files[1].value.value_structId, project.structIds.mainQuest);
      assert.equal(result.files[2].value.value_structId, project.structIds.subQuestDictionary);
    });
    test("own IDs remain distinct from parent IDs, struct IDs and bucket offsets through save, reorder and deletion", () => {
      const project = source(5);
      project.chapters[0].id = 37;
      project.mainQuests[0].id = 58; project.mainQuests[0].chapterId = 37;
      const otherMain = createQuestMain(project); otherMain.id = 6;
      [9999, 0, 199, 99, 100].forEach((id, index) => {
        project.subQuests[index].id = id; project.subQuests[index].mainQuestId = 58;
      });
      project.subQuests[0].nextQuestIds = [100, null, 99]; project.subQuests[0].failureQuestId = 99;
      project.structIds = { chapter: "9001", mainQuest: "9002", subQuest: "9003", subQuestDictionary: "9004", positionSlot: "9005" };
      project.mainQuests.reverse(); project.subQuests.reverse();
      const before = encodeQuestProject(project), restored = decodeQuestProject(before);
      const { result, chapters, mains, subs } = exported(restored);
      assert.equal(values(chapters)[0].value.id.value, "37");
      assert.deepEqual(values(mains).map(value => [value.value.id.value, value.value.chapter.value]), [["6", "-1"], ["58", "37"]]);
      assert.deepEqual(keys(subs), [0, 1, 99]);
      const rows = values(subs).flatMap(bucket => values(bucket.value["子任务字典"]));
      assert.deepEqual(rows.map(value => value.value.id.value), ["0", "99", "100", "199", "9999"]);
      assert.ok(rows.every(value => value.value.mainQuestId.value === "58"));
      assert.equal(result.files[2].value.value_structId, "9004");
      assert.ok(rows.every(value => value.toQxqyValue().structId === "9003"));
      assert.deepEqual(rows.at(-1).value["后续任务"].value, ["100", "-1", "99"]);
      assert.equal(encodeQuestProject(restored), before); assert.equal(encodeQuestProject(project), before);
      removeQuestSubQuests(restored, new Set([99]));
      restored.subQuests.find(sub => sub.id === 199).mainQuestId = 6;
      const afterRows = values(exported(restored).subs).flatMap(bucket => values(bucket.value["子任务字典"]));
      assert.deepEqual(afterRows.map(value => value.value.id.value), ["0", "100", "199", "9999"]);
      assert.equal(afterRows[2].value.mainQuestId.value, "6");
      assert.deepEqual(afterRows.at(-1).value["后续任务"].value, ["100", "-1", "-1"]);
      assert.equal(afterRows.at(-1).value["失败回溯任务"].value, "-1");
    });
    test("factories create independent slot defaults matching the camera template", () => {
      const project = source();
      const first = project.subQuests[0];
      const second = createQuestSub(project, 0);
      assert.deepEqual(first.investigationPoint, { space: 0, pointType: "Vector3", vector3: "0,0,0", guid: "0", entity: "", attachmentPoint: "", offset: "0,0,0", requiresClientPos: false });
      first.investigationPoint.vector3 = "1,2,3";
      assert.equal(second.investigationPoint.vector3, "0,0,0");
      assert.equal(first.investigationRange, -1); assert.equal(first.hidden, false);
    });
    test("chapter/main/sub relationships and new field order match independent definitions", () => {
      const project = source();
      project.chapters[0].id = 7; project.mainQuests[0].id = 21; project.mainQuests[0].chapterId = 7;
      const sub = project.subQuests[0];
      Object.assign(sub, { mainQuestId: 21, description: "任务说明", unitState: "18446744073709551615", hidden: true, investigationRange: 2.75 });
      Object.assign(sub.investigationPoint, { space: 1, pointType: "Guid", guid: "18446744073709551615", vector3: "-160,900,0.125", offset: "1,2,3", attachmentPoint: "Head", requiresClientPos: true });
      const result = exported(project);
      assert.deepEqual(keys(result.chapters), [7]); assert.deepEqual(keys(result.mains), [21]);
      assert.equal(values(result.mains)[0].value.chapter.value, "7");
      const value = values(values(result.subs)[0].value["子任务字典"])[0];
      assert.deepEqual(Object.keys(value.value), ["id", "mainQuestId", "title", "desc", "任务单位状态", "任务调查点预设点", "调查点范围", "隐藏任务", "后续任务", "失败回溯任务", "finishMainQuest", "questProgress"]);
      assert.equal(value.value["mainQuestId"].type, "Int32"); assert.equal(value.value["mainQuestId"].value, "21");
      assert.equal(value.value["title"].value, sub.title); assert.equal(value.value["desc"].value, sub.description);
      assert.equal(value.value["任务单位状态"].value, sub.unitState);
      assert.equal(value.value["隐藏任务"].value, "True"); assert.equal(value.value["调查点范围"].value, "2.75");
      assert.equal(value.value["后续任务"].type, "Int32List");
      assert.deepEqual(value.value["后续任务"].value, []);
      const slot = value.value["任务调查点预设点"];
      assert.equal(Object.keys(slot.value).length, 8);
      assert.equal(slot.value.guid.value, sub.investigationPoint.guid);
      assert.equal(slot.value.requiresClientPos.value, "True");
    });
    test("new sub fields use exact source types/defaults and preserve the twelve-field order", () => {
      const project = source();
      const definition = require(path.join(assetDirectory, "1077936145[任务]子任务.json"));
      assert.deepEqual(definition.value.map((field) => [field.key, field.param_type]), [
        ["id", "Int32"], ["mainQuestId", "Int32"], ["title", "String"], ["desc", "String"], ["任务单位状态", "ConfigReference"],
        ["任务调查点预设点", "Struct"], ["调查点范围", "Float"], ["隐藏任务", "Bool"], ["后续任务", "Int32List"],
        ["失败回溯任务", "Int32"], ["finishMainQuest", "Bool"], ["questProgress", "Int32"],
      ]);
      assert.deepEqual(definition.value.slice(9).map((field) => field.value.value), ["-1", "False", "0"]);
      const sub = project.subQuests[0];
      assert.equal(sub.failureQuestId, -1); assert.equal(sub.finishMainQuest, false); assert.equal(sub.questProgress, 0);
      const { subs, result } = exported(project);
      const value = values(values(subs)[0].value["子任务字典"])[0];
      assert.deepEqual(Object.keys(value.value), definition.value.map((field) => field.key));
      assert.equal(value.value["失败回溯任务"].value, "-1"); assert.equal(value.value.finishMainQuest.value, "False"); assert.equal(value.value.questProgress.value, "0");
      assert.deepEqual(result.warnings.filter((warning) => /失败回溯/.test(warning)), []);
    });
    test("old sub documents backfill only missing new fields without changing IDs, references or existing values", () => {
      const project = source(3);
      project.subQuests[0].id = 199; project.subQuests[0].nextQuestIds = [null, 1, 2];
      delete project.subQuests[0].failureQuestId; delete project.subQuests[0].finishMainQuest; delete project.subQuests[0].questProgress;
      Object.assign(project.subQuests[1], { failureQuestId: 199, finishMainQuest: true, questProgress: 100 });
      Object.assign(project.subQuests[2], { failureQuestId: null, finishMainQuest: false, questProgress: -2147483648 });
      const raw = JSON.stringify(project), expected = JSON.parse(raw);
      Object.assign(expected.subQuests[0], { failureQuestId: -1, finishMainQuest: false, questProgress: 0 });
      const decoded = decodeQuestProject(raw);
      assert.deepEqual(decoded, expected); assert.equal(JSON.stringify(project), raw);
      assert.deepEqual(decodeQuestProject(encodeQuestProject(decoded)), decoded);
      assert.deepEqual(decoded.subQuests.map((sub) => sub.id), [199, 1, 2]);
    });
    test("custom IDs and cross-bucket rollback references export global IDs with literal title/desc", () => {
      const project = source(2);
      project.subQuests[0].id = 199; project.subQuests[1].id = 100;
      Object.assign(project.subQuests[0], { title: "回溯任务", description: "原样保留\n第二行", failureQuestId: 100, finishMainQuest: true, questProgress: 2147483647 });
      Object.assign(project.subQuests[1], { failureQuestId: 0, finishMainQuest: false, questProgress: -2147483648 });
      project.structIds = Object.fromEntries(Object.keys(project.structIds).map((key, index) => [key, String(20000 + index)]));
      const before = JSON.stringify(project), { subs, result } = exported(project);
      assert.deepEqual(keys(subs), [1]);
      const inner = values(subs)[0].value["子任务字典"];
      assert.deepEqual(keys(inner), [100, 199]);
      const value = values(inner)[1];
      assert.equal(value.toQxqyValue().structId, project.structIds.subQuest);
      assert.equal(value.value.title.value, "回溯任务"); assert.equal(value.value.desc.value, "原样保留\n第二行");
      assert.equal(value.value["失败回溯任务"].value, "100"); assert.equal(value.value.finishMainQuest.value, "True"); assert.equal(value.value.questProgress.value, "2147483647");
      assert.equal(values(inner)[0].value.questProgress.value, "-2147483648");
      assert.ok(result.warnings.some((warning) => /子任务 100/.test(warning) && /失败回溯任务（ID 0）/.test(warning)));
      assert.ok(!result.warnings.some((warning) => /子任务 199/.test(warning) && /失败回溯/.test(warning)));
      assert.equal(JSON.stringify(project), before);
    });
    test("rollback deletion clears references across main quests, keeps defaults/external targets and never resurrects", () => {
      const project = source(5); createQuestMain(project);
      project.subQuests[2].mainQuestId = 1;
      Object.assign(project.subQuests[0], { failureQuestId: 1, nextQuestIds: [1, null, 1] });
      project.subQuests[2].failureQuestId = 1; project.subQuests[3].failureQuestId = 9999;
      const removed = removeQuestSubQuests(project, new Set([1, 9999]));
      assert.deepEqual(removed, { removedCount: 1, clearedReferenceCount: 4 });
      assert.deepEqual(project.subQuests.map((sub) => sub.id), [0, 2, 3, 4]);
      assert.deepEqual(project.subQuests.map((sub) => sub.failureQuestId), [null, null, 9999, -1]);
      assert.deepEqual(project.subQuests[0].nextQuestIds, [null, null, null]);
      assert.equal(createQuestSub(project, 0).id, 1);
      assert.equal(project.subQuests[0].failureQuestId, null); assert.equal(project.subQuests[1].failureQuestId, null);
      const restored = decodeQuestProject(encodeQuestProject(project));
      const { result, subs } = exported(restored);
      const value = values(values(subs)[0].value["子任务字典"])[0];
      assert.equal(value.value["失败回溯任务"].value, "-1");
      const warnings = result.warnings.filter((warning) => /失败回溯/.test(warning));
      assert.equal(warnings.length, 3);
      assert.ok(warnings.some((warning) => /子任务 0/.test(warning) && /为空/.test(warning)));
      assert.ok(warnings.some((warning) => /子任务 2/.test(warning) && /为空/.test(warning)));
      assert.ok(warnings.some((warning) => /9999/.test(warning) && /仍保留/.test(warning)));
    });
    test("new field validation rejects wrong booleans and non-Int32 values in draft and export", () => {
      const cases = {
        failureQuestId: ["1", true, {}, 1.5, 2147483648, -2147483649, NaN, Infinity],
        finishMainQuest: ["False", "True", 0, 1, null, {}],
        questProgress: ["1", true, null, {}, 1.5, 2147483648, -2147483649, NaN, Infinity],
      };
      for (const [field, invalid] of Object.entries(cases)) for (const value of invalid) {
        const project = source(); project.subQuests[0][field] = value;
        assert.ok(validateQuestProject(project).length, `${field}: ${String(value)}`);
        assert.ok(validateQuestProject(project, { allowDraftValues: true }).length);
        assert.throws(() => exportQuestVariables(project));
        if (typeof value !== "number" || Number.isFinite(value)) assert.throws(() => decodeQuestProject(JSON.stringify(project)));
      }
      const project = source(2); project.subQuests[0].failureQuestId = 0; project.subQuests[1].failureQuestId = -2147483648;
      const { subs } = exported(project);
      const subValues = values(values(subs)[0].value["子任务字典"]);
      assert.equal(subValues[0].value["失败回溯任务"].value, "0"); assert.equal(subValues[1].value["失败回溯任务"].value, "-2147483648");
    });
    test("follow-up lists start empty and are independent for each new sub quest", () => {
      const project = source();
      const first = project.subQuests[0];
      const second = createQuestSub(project, first.mainQuestId);
      assert.deepEqual(first.nextQuestIds, []);
      assert.deepEqual(second.nextQuestIds, []);
      assert.notEqual(first.nextQuestIds, second.nextQuestIds);
      first.nextQuestIds.push(100);
      assert.deepEqual(second.nextQuestIds, []);
      const { subs } = exported(project);
      const items = values(values(subs)[0].value["子任务字典"]);
      assert.deepEqual(items[0].value["后续任务"].value, ["100"]);
      assert.deepEqual(items[1].value["后续任务"].value, []);
    });
    test("old saved projects backfill only missing follow-up lists without changing existing data", () => {
      const project = source(3);
      delete project.subQuests[0].nextQuestIds;
      delete project.subQuests[1].nextQuestIds;
      project.subQuests[2].nextQuestIds = [199, 0, -1, 199];
      const raw = JSON.stringify(project);
      const decoded = decodeQuestProject(raw);
      assert.deepEqual(decoded, {
        ...project,
        subQuests: project.subQuests.map((sub) => ({ ...sub, nextQuestIds: sub.nextQuestIds ?? [] })),
      });
      assert.equal(JSON.stringify(project), raw);
      assert.notEqual(decoded.subQuests[0].nextQuestIds, decoded.subQuests[1].nextQuestIds);
      assert.deepEqual(decoded.subQuests[2].nextQuestIds, [199, 0, -1, 199]);
      assert.deepEqual(validateQuestProject(decoded), []);
      exported(decoded);
    });
    test("follow-up lists preserve order, duplicates, zero, negatives and full cross-bucket IDs", () => {
      const project = source(3);
      [0, 100, 9999].forEach((id, index) => { project.subQuests[index].id = id; });
      const expected = [199, 100, 0, -1, 9999, 199, -2147483648, 2147483647];
      project.subQuests[1].nextQuestIds = [...expected];
      const before = JSON.stringify(project);
      assert.deepEqual(validateQuestProject(project), []);
      assert.deepEqual(validateQuestProject(project, { allowDraftValues: true }), []);
      const { subs } = exported(project);
      const inner = values(subs)[1].value["子任务字典"];
      assert.deepEqual(keys(inner), [100]);
      const followups = values(inner)[0].value["后续任务"];
      assert.equal(followups.type, "Int32List");
      assert.deepEqual(followups.value, expected.map(String));
      assert.equal(JSON.stringify(project), before);
      assert.deepEqual(project.subQuests[1].nextQuestIds, expected);
    });
    test("follow-up lists accept 100 IDs and reject 101 without truncating or mutating", () => {
      const project = source();
      project.subQuests[0].nextQuestIds = Array.from({ length: 100 }, (_, index) => 199 - index);
      assert.deepEqual(validateQuestProject(project), []);
      assert.deepEqual(decodeQuestProject(encodeQuestProject(project)), project);
      const { subs } = exported(project);
      assert.deepEqual(values(values(subs)[0].value["子任务字典"])[0].value["后续任务"].value, project.subQuests[0].nextQuestIds.map(String));
      project.subQuests[0].nextQuestIds.push(0);
      const before = JSON.stringify(project);
      for (const options of [{}, { allowDraftValues: true }]) {
        assert.ok(validateQuestProject(project, options).some((error) => /后续任务/.test(error)));
      }
      assert.throws(() => decodeQuestProject(encodeQuestProject(project)), /后续任务/);
      assert.throws(() => exportQuestVariables(project), /后续任务/);
      assert.equal(JSON.stringify(project), before);
    });
    test("follow-up lists reject wrong containers and non-Int32 entries in strict and draft modes", () => {
      const invalidValues = [null, "100", 100, {}, ["100"], [true], [1.5], [2147483648], [-2147483649], [NaN], [Infinity]];
      for (const nextQuestIds of invalidValues) {
        const project = source();
        project.subQuests[0].nextQuestIds = nextQuestIds;
        for (const options of [{}, { allowDraftValues: true }]) {
          assert.ok(validateQuestProject(project, options).some((error) => /后续任务/.test(error)), `accepted ${JSON.stringify(nextQuestIds)}`);
        }
        // JSON encodes NaN/Infinity as null, now a valid cleared slot; reject the original numbers before export.
        if (!Array.isArray(nextQuestIds) || nextQuestIds.every((id) => typeof id !== "number" || Number.isFinite(id))) {
          assert.throws(() => decodeQuestProject(encodeQuestProject(project)), /后续任务/);
        }
        assert.throws(() => exportQuestVariables(project), /后续任务/);
      }
    });
    test("cleared slots persist as null through saving and export as -1 without shifting positions", () => {
      const project = source(2);
      project.subQuests[0].id = 199;
      project.subQuests[0].nextQuestIds = [null, 1, null, 9999, -1, null];
      for (const options of [{}, { allowDraftValues: true }]) assert.deepEqual(validateQuestProject(project, options), []);
      const before = JSON.stringify(project);
      const restored = decodeQuestProject(encodeQuestProject(project));
      assert.deepEqual(restored, project);
      const { result, subs } = exported(restored);
      const inner = values(subs)[1].value["子任务字典"];
      assert.deepEqual(keys(inner), [199]);
      assert.deepEqual(values(inner)[0].value["后续任务"].value, ["-1", "1", "-1", "9999", "-1", "-1"]);
      const warnings = result.warnings.filter((warning) => /后续任务/.test(warning));
      assert.ok(warnings.some((warning) => /199/.test(warning) && /空/.test(warning)), "Cleared slots identify their source task");
      for (const position of [1, 3, 6]) assert.ok(warnings.some((warning) => /199/.test(warning) && new RegExp(`(?:^|\\D)${position}(?:\\D|$)`).test(warning)), `Missing warning for 1-based slot ${position}`);
      assert.ok(warnings.some((warning) => /199/.test(warning) && /9999/.test(warning) && /4/.test(warning)), "Missing reference warning identifies source and position");
      assert.equal(JSON.stringify(project), before);
      assert.deepEqual(restored.subQuests[0].nextQuestIds, [null, 1, null, 9999, -1, null]);
    });
    test("empty and fully resolved follow-up lists produce no reference warning", () => {
      const project = source(2);
      project.subQuests[0].nextQuestIds = [];
      project.subQuests[1].nextQuestIds = [0, 1, 0];
      assert.deepEqual(exported(project).result.warnings.filter((warning) => /后续任务/.test(warning)), []);
    });
    test("nullable follow-up lists still enforce the 100-slot limit in strict and draft modes", () => {
      const project = source();
      project.subQuests[0].nextQuestIds = Array(100).fill(null);
      assert.deepEqual(validateQuestProject(project), []);
      assert.deepEqual(decodeQuestProject(encodeQuestProject(project)), project);
      const { subs } = exported(project);
      assert.deepEqual(values(values(subs)[0].value["子任务字典"])[0].value["后续任务"].value, Array(100).fill("-1"));
      project.subQuests[0].nextQuestIds.push(null);
      for (const options of [{}, { allowDraftValues: true }]) assert.ok(validateQuestProject(project, options).some((error) => /后续任务/.test(error)));
      assert.throws(() => decodeQuestProject(encodeQuestProject(project)), /后续任务/);
      assert.throws(() => exportQuestVariables(project), /后续任务/);
    });
    test("deleting tasks clears all surviving duplicate references across mains without reindexing", () => {
      const project = source(5);
      const secondMain = createQuestMain(project);
      project.subQuests[3].mainQuestId = secondMain.id;
      project.subQuests[0].nextQuestIds = [1, 2, 1, null, 4, 9999];
      project.subQuests[1].nextQuestIds = [2, 1];
      project.subQuests[3].nextQuestIds = [2, 1, 2];
      project.subQuests[4].nextQuestIds = [];
      const result = removeQuestSubQuests(project, new Set([1, 2, 9999]));
      assert.deepEqual(result, { removedCount: 2, clearedReferenceCount: 6 });
      assert.deepEqual(project.subQuests.map((sub) => sub.id), [0, 3, 4]);
      assert.deepEqual(project.subQuests[0].nextQuestIds, [null, null, null, null, 4, 9999]);
      assert.deepEqual(project.subQuests[1].nextQuestIds, [null, null, null]);
      assert.deepEqual(project.subQuests[2].nextQuestIds, []);
      assert.equal(project.subQuests[1].mainQuestId, secondMain.id);
      assert.deepEqual(decodeQuestProject(encodeQuestProject(project)), project);
    });
    test("deleting absent IDs or an empty set does not clear future references", () => {
      const project = source(2);
      project.subQuests[0].nextQuestIds = [9999, null, 1];
      const before = JSON.stringify(project);
      for (const ids of [new Set(), new Set([9999, 7777])]) {
        assert.deepEqual(removeQuestSubQuests(project, ids), { removedCount: 0, clearedReferenceCount: 0 });
        assert.equal(JSON.stringify(project), before);
      }
    });
    test("reusing a deleted task ID never resurrects a cleared reference", () => {
      const project = source(3);
      project.subQuests[0].nextQuestIds = [1, 2, 1];
      assert.deepEqual(removeQuestSubQuests(project, new Set([1])), { removedCount: 1, clearedReferenceCount: 2 });
      const replacement = createQuestSub(project, 0);
      assert.equal(replacement.id, 1);
      assert.deepEqual(project.subQuests[0].nextQuestIds, [null, 2, null]);
      const { subs } = exported(project);
      assert.deepEqual(values(values(subs)[0].value["子任务字典"])[0].value["后续任务"].value, ["-1", "2", "-1"]);
    });
    test("follow-up IDs survive codec roundtrip with custom struct IDs and future references", () => {
      const project = source();
      project.structIds = { chapter: "9011", mainQuest: "9012", subQuest: "9013", subQuestDictionary: "9014", positionSlot: "9015" };
      project.subQuests[0].id = 199;
      project.subQuests[0].nextQuestIds = [9999, 100, 200, 0, 100, -1];
      const before = JSON.stringify(project);
      const restored = decodeQuestProject(encodeQuestProject(project));
      assert.deepEqual(restored, project);
      const { result, subs } = exported(restored);
      assert.equal(result.files[2].value.value_structId, "9014");
      assert.deepEqual(keys(subs), [1]);
      const inner = values(subs)[0].value["子任务字典"];
      assert.deepEqual(keys(inner), [199]);
      const sub = values(inner)[0];
      assert.equal(sub.toQxqyValue().structId, "9013");
      assert.equal(sub.value["后续任务"].type, "Int32List");
      assert.deepEqual(sub.value["后续任务"].value, ["9999", "100", "200", "0", "100", "-1"]);
      assert.equal(JSON.stringify(project), before);
    });
    test("empty chapters survive and direct main quests use configurable unassigned sentinel", () => {
      const project = createQuestProject();
      createQuestChapter(project); createQuestMain(project);
      project.unassignedChapterId = -42;
      const { chapters, mains } = exported(project);
      assert.equal(chapters.itemCount, 1); assert.equal(values(mains)[0].value.chapter.value, "-42");
      assert.equal(project.mainQuests[0].chapterId, null);
    });
    test("main quest factories and source definitions use id/chapter/title/style with Mainline default", () => {
      const project = source();
      assert.equal(project.mainQuests[0].style, "Mainline");
      assert.equal(createQuestMain(project).style, "Mainline");
      const definition = require(path.join(assetDirectory, "1077936166[任务]主任务.json"));
      assert.deepEqual(definition.value.map((field) => [field.key, field.param_type]), [
        ["id", "Int32"], ["chapter", "Int32"], ["title", "String"], ["style", "String"],
      ]);
      assert.equal(definition.value[3].value.value, "Mainline");
      const { chapters, mains } = exported(project);
      const main = values(mains)[0];
      assert.deepEqual(Object.keys(main.value), ["id", "chapter", "title", "style"]);
      assert.equal(main.value.chapter.type, "Int32");
      assert.equal(main.value.title.type, "String");
      assert.equal(main.value.title.value, project.mainQuests[0].title);
      assert.equal(main.value.style.type, "String");
      assert.equal(main.value.style.value, "Mainline");
      assert.deepEqual(Object.keys(values(chapters)[0].value), ["id", "标题"], "Chapter title must not be renamed with main quest fields");
      assert.equal(values(chapters)[0].value["标题"].value, project.chapters[0].title);
    });
    test("old project decoding fills only missing main styles alongside missing follow-up lists", () => {
      const project = source(3);
      createQuestMain(project); createQuestMain(project);
      delete project.mainQuests[0].style;
      project.mainQuests[1].style = "自定义任务样式";
      project.mainQuests[2].style = "";
      delete project.subQuests[0].nextQuestIds;
      project.subQuests[1].nextQuestIds = [null, 2];
      project.subQuests[2].nextQuestIds = [0];
      const before = JSON.stringify(project);
      const expected = JSON.parse(before);
      expected.mainQuests[0].style = "Mainline";
      expected.subQuests[0].nextQuestIds = [];
      const restored = decodeQuestProject(before);
      assert.deepEqual(restored, expected);
      assert.equal(restored.schemaVersion, 1);
      assert.deepEqual(restored.mainQuests.map((main) => main.style), ["Mainline", "自定义任务样式", ""]);
      assert.equal(JSON.stringify(project), before);
      assert.deepEqual(validateQuestProject(restored), []);
      assert.deepEqual(decodeQuestProject(encodeQuestProject(restored)), restored);
      exported(restored);
    });
    test("main styles preserve default, empty and custom Unicode strings through codec and real export", () => {
      const project = source();
      createQuestMain(project); createQuestMain(project); createQuestMain(project);
      const styles = ["Mainline", "", "支线任务·夜色🌙", "  Custom_UI  "];
      project.mainQuests.forEach((main, index) => { main.style = styles[index]; main.title = `主任务标题 ${index}`; });
      const before = JSON.stringify(project);
      const restored = decodeQuestProject(encodeQuestProject(project));
      assert.deepEqual(restored, project);
      const { mains } = exported(restored);
      assert.deepEqual(values(mains).map((main) => main.value.style.value), styles);
      assert.deepEqual(values(mains).map((main) => main.value.title.value), project.mainQuests.map((main) => main.title));
      assert.equal(JSON.stringify(project), before);
      assert.deepEqual(restored, project);
    });
    test("non-string main styles are rejected in strict validation, draft decoding and export", () => {
      for (const style of [null, 0, 123, false, [], {}, ["Mainline"]]) {
        const project = source();
        project.mainQuests[0].style = style;
        for (const options of [{}, { allowDraftValues: true }]) {
          assert.ok(validateQuestProject(project, options).some((error) => /样式|style/.test(error)), `accepted ${JSON.stringify(style)}`);
        }
        assert.throws(() => decodeQuestProject(encodeQuestProject(project)), /样式|style/);
        assert.throws(() => exportQuestVariables(project), /样式|style/);
      }
      const missing = source(); delete missing.mainQuests[0].style;
      assert.ok(validateQuestProject(missing).some((error) => /样式|style/.test(error)));
      assert.equal(decodeQuestProject(encodeQuestProject(missing)).mainQuests[0].style, "Mainline");
    });
    test("custom main struct IDs retain the chapter sentinel and exact custom style without mutation", () => {
      const project = createQuestProject();
      project.structIds = { chapter: "9501", mainQuest: "9502", subQuest: "9503", subQuestDictionary: "9504", positionSlot: "9505" };
      project.unassignedChapterId = -42;
      const main = createQuestMain(project);
      main.id = 21; main.title = "直属任务"; main.style = "Branch_Custom";
      const before = JSON.stringify(project);
      const { result, mains } = exported(project);
      assert.equal(result.files[1].value.value_structId, "9502");
      assert.deepEqual(keys(mains), [21]);
      const value = values(mains)[0];
      assert.equal(value.toQxqyValue().structId, "9502");
      assert.deepEqual(Object.keys(value.value), ["id", "chapter", "title", "style"]);
      assert.equal(value.value.chapter.value, "-42");
      assert.equal(value.value.title.value, "直属任务");
      assert.equal(value.value.style.value, "Branch_Custom");
      assert.equal(JSON.stringify(project), before);
      assert.equal(main.chapterId, null);
    });
    for (const count of [100, 101, 110]) test(`${count} sub quests use 100-entry buckets and complete global inner IDs`, () => {
      const { subs } = exported(source(count));
      assert.deepEqual(keys(subs), count > 100 ? [0, 1] : [0]);
      const dictionaries = values(subs).map((value) => value.value["子任务字典"]);
      assert.deepEqual(dictionaries.map((dict) => dict.itemCount), count > 100 ? [100, count - 100] : [100]);
      assert.deepEqual(dictionaries.flatMap(keys), Array.from({ length: count }, (_, id) => id));
    });
    test("sparse IDs 0/99/100/199/9999 retain exact global keys rather than remainder indices", () => {
      const project = source(5);
      [0, 99, 100, 199, 9999].forEach((id, index) => project.subQuests[index].id = id);
      project.subQuests.reverse();
      const { subs } = exported(project);
      assert.deepEqual(keys(subs), [0, 1, 99]);
      assert.deepEqual(values(subs).map((value) => keys(value.value["子任务字典"])), [[0, 99], [100, 199], [9999]]);
    });
    test("10000 sub quests fill exactly 100 buckets of 100 entries", () => {
      const project = source(10000);
      assert.deepEqual(validateQuestProject(project), []);
      const raw = exportQuestVariables(project).files[2].value;
      assert.equal(raw.value.length, 100);
      raw.value.forEach((entry, bucketId) => {
        assert.equal(entry.key.value, String(bucketId));
        const inner = entry.value.value.value[0].value;
        assert.equal(inner.value.length, 100);
        assert.equal(inner.value[0].key.value, String(bucketId * 100));
        assert.equal(inner.value[99].key.value, String(bucketId * 100 + 99));
        inner.value.forEach((item) => {
          assert.deepEqual(item.value.value.value[0], { param_type: "Int32", value: item.key.value });
        });
      });
      assert.throws(() => createQuestSub(project, 0), /10000/);
    });
    test("10001 sub quests and ID 10000 are rejected without truncation", () => {
      const project = source(10001);
      assert.throws(() => exportQuestVariables(project), /10000/);
      const single = source(); single.subQuests[0].id = 10000;
      assert.throws(() => exportQuestVariables(single), /9999/);
    });
    test("chapter and main dictionaries enforce 100 entries", () => {
      const project = createQuestProject();
      for (let i = 0; i < 100; i++) { createQuestChapter(project); createQuestMain(project); }
      assert.deepEqual(validateQuestProject(project), []);
      assert.equal(exportQuestVariables(project).files[0].value.value.length, 100);
      assert.throws(() => createQuestChapter(project), /100/); assert.throws(() => createQuestMain(project), /100/);
      project.chapters.push({ id: 100, title: "溢出" });
      assert.throws(() => exportQuestVariables(project), /章节最多支持 100/);
      project.chapters.pop(); project.mainQuests.push({ id: 100, chapterId: null, title: "溢出", style: "Mainline" });
      assert.throws(() => exportQuestVariables(project), /主任务最多支持 100/);
    });
    test("IDs are stable through reorder and deleting a different item; new IDs avoid collisions", () => {
      const project = source(3); project.subQuests.reverse(); project.subQuests.splice(1, 1);
      assert.deepEqual(project.subQuests.map((sub) => sub.id), [2, 0]);
      assert.equal(createQuestSub(project, 0).id, 1);
      const before = JSON.stringify(project);
      exported(project);
      assert.equal(JSON.stringify(project), before);
    });
    test("all custom struct IDs propagate recursively into root/nested structs and dictionaries", () => {
      const project = source(101);
      project.structIds = { chapter: "9001", mainQuest: "9002", subQuest: "9003", subQuestDictionary: "9004", positionSlot: "9005" };
      const { result } = exported(project);
      const found = new Set();
      function visit(value) {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (key === "structId" || key === "value_structId") { assert.ok(Object.values(project.structIds).includes(child)); found.add(child); }
          else visit(child);
        }
      }
      result.files.forEach((file) => visit(file.value));
      assert.deepEqual([...found].sort(), Object.values(project.structIds).sort());
    });
    test("save/decode preserves all content, IDs and references without mutation", () => {
      const project = source(110);
      assert.deepEqual(decodeQuestProject(encodeQuestProject(project)), project);
      assert.throws(() => decodeQuestProject("broken JSON"), /JSON/);
      for (const value of [null, [], {}, { kind: "DSFGQuest", schemaVersion: 2 }]) assert.throws(() => decodeQuestProject(JSON.stringify(value)));
      const invalid = source(); delete invalid.subQuests[0].hidden;
      assert.throws(() => decodeQuestProject(JSON.stringify(invalid)), /隐藏/);
    });
    test("unfinished numeric text drafts save and reopen unchanged but cannot export", () => {
      for (const draft of ["", "-", "1,", "1,2,", "unfinished"]) {
        const project = source();
        project.subQuests[0].unitState = draft;
        project.subQuests[0].investigationPoint.guid = draft;
        project.subQuests[0].investigationPoint.vector3 = draft;
        project.subQuests[0].investigationPoint.offset = draft;
        assert.deepEqual(decodeQuestProject(encodeQuestProject(project)), project);
        assert.throws(() => exportQuestVariables(project));
      }
    });
    test("draft decoding still rejects wrong types, invalid IDs and broken references", () => {
      for (const mutate of [
        (p) => p.subQuests[0].unitState = 0,
        (p) => p.subQuests[0].investigationPoint.guid = 123,
        (p) => p.subQuests[0].investigationPoint.vector3 = [1, 2, 3],
        (p) => p.subQuests[0].investigationPoint.offset = null,
        (p) => p.subQuests[0].id = -1,
        (p) => p.subQuests[0].mainQuestId = 42,
        (p) => p.structIds.subQuest = "bad",
      ]) {
        const project = source(); mutate(project);
        assert.throws(() => decodeQuestProject(encodeQuestProject(project)));
      }
    });
    test("missing parents and duplicate IDs fail instead of silently orphaning or renumbering tasks", () => {
      for (const mutate of [
        (p) => p.chapters.splice(0), (p) => p.mainQuests.splice(0),
        (p) => p.subQuests.push({ ...p.subQuests[0] }), (p) => p.chapters.push({ ...p.chapters[0] }),
        (p) => p.mainQuests.push({ ...p.mainQuests[0] }), (p) => p.unassignedChapterId = 0,
      ]) { const project = source(); mutate(project); assert.throws(() => exportQuestVariables(project)); }
      assert.throws(() => createQuestMain(createQuestProject(), 0), /不存在/);
      assert.throws(() => createQuestSub(createQuestProject(), 0), /不存在/);
    });
    test("invalid Vector3, Guid, ConfigReference, booleans and numeric fields are rejected", () => {
      for (const mutate of [
        (s) => s.investigationPoint.vector3 = "1,2", (s) => s.investigationPoint.offset = "0,Infinity,1",
        (s) => s.investigationPoint.guid = "1.5", (s) => s.investigationPoint.guid = 18446744073709551615,
        (s) => s.unitState = "abc", (s) => s.unitState = 12,
        (s) => s.investigationPoint.space = 2, (s) => s.investigationPoint.pointType = "Unknown",
        (s) => s.investigationPoint.requiresClientPos = "False", (s) => s.hidden = "False",
        (s) => s.investigationRange = Infinity,
      ]) { const project = source(); mutate(project.subQuests[0]); assert.throws(() => exportQuestVariables(project)); }
    });
    test("invalid or duplicate struct IDs fail before any export", () => {
      for (const id of ["bad", "", " 123", "1077936165", "01077936165"]) {
        const project = source(); project.structIds.subQuest = id;
        assert.throws(() => exportQuestVariables(project), /ID/);
      }
    });
    test("export neither mutates source definitions nor lets stale sample fields leak into output", () => {
      const assets = fs.readdirSync(assetDirectory).filter((name) => name.endsWith(".json"));
      const snapshots = assets.map((name) => [name, fs.readFileSync(path.join(assetDirectory, name), "utf8"), JSON.stringify(require(path.join(assetDirectory, name)))]);
      const project = source();
      project.subQuests[0].nextQuestIds = [199, 100, 0, -1, 199];
      exportQuestVariables(project);
      for (const [name, text, loaded] of snapshots) {
        assert.equal(fs.readFileSync(path.join(assetDirectory, name), "utf8"), text);
        assert.equal(JSON.stringify(require(path.join(assetDirectory, name))), loaded);
      }
      const independent = require(path.join(assetDirectory, "1077936145[任务]子任务.json"));
      assert.equal(independent.value[5].value.value.value.length, 10);
      assert.equal(independent.value[0].param_type, "Int32");
      assert.equal(independent.value[8].key, "后续任务");
      assert.equal(independent.value[8].param_type, "Int32List");
      assert.equal(createQuestStructWorkspace(project.structIds).createDefault(project.structIds.subQuest).value["任务调查点预设点"].toQxqyValue().value.length, 8);
    });
    console.log(`${passed} quest export tests passed.`);
  } finally {
    Module._load = originalLoad;
    if (originalExtension) Module._extensions[".ts"] = originalExtension; else delete Module._extensions[".ts"];
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
