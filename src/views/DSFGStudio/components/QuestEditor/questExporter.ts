import { VariableValue, VariableWorkspace, type StructDefinition } from "miliastra-variable";
import chapterDefinition from "@/assets/DSFGStudio/Quest/1077936165[任务]章节.json";
import mainDefinition from "@/assets/DSFGStudio/Quest/1077936166[任务]主任务.json";
import subDefinition from "@/assets/DSFGStudio/Quest/1077936145[任务]子任务.json";
import subDictionaryDefinition from "@/assets/DSFGStudio/Quest/1077936167[任务]子任务字典.json";
import slotDefinition from "@/assets/DSFGStudio/Quest/1077936164PositionSlot.json";
import chapterVariable from "@/assets/DSFGStudio/Quest/NOLOC_章节配置.json";
import mainVariable from "@/assets/DSFGStudio/Quest/NOLOC_主任务配置.json";
import subVariable from "@/assets/DSFGStudio/Quest/NOLOC_子任务.json";
import { DEFAULT_QUEST_STRUCT_IDS, QUEST_STRUCT_ID_FIELDS, validateQuestProject } from "./questProject";
import type { QuestProject, QuestStructIds } from "./types";

export { QUEST_STRUCT_ID_FIELDS } from "./questProject";

const definitions: Record<keyof QuestStructIds, StructDefinition> = {
  chapter: chapterDefinition as StructDefinition,
  mainQuest: mainDefinition as StructDefinition,
  subQuest: subDefinition as StructDefinition,
  subQuestDictionary: subDictionaryDefinition as StructDefinition,
  positionSlot: slotDefinition as StructDefinition,
};

function remapIds(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((child) => remapIds(child, replacements));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    (key === "structId" || key === "value_structId") && typeof child === "string"
      ? replacements.get(child) ?? child : remapIds(child, replacements),
  ]));
}

function idReplacements(ids: QuestStructIds) {
  return new Map(QUEST_STRUCT_ID_FIELDS.map(({ key }) => [DEFAULT_QUEST_STRUCT_IDS[key], ids[key]]));
}

/** 只克隆/规范化导出使用的定义，不写回源 JSON，也不影响对话编辑器的结构体。 */
export function createQuestStructWorkspace(ids: QuestStructIds): VariableWorkspace {
  const replacements = idReplacements(ids);
  const remapped = Object.fromEntries(QUEST_STRUCT_ID_FIELDS.map(({ key }) => [
    ids[key], remapIds(definitions[key], replacements) as StructDefinition,
  ]));
  // 子任务内嵌样例多出两个未命名 Int32；暂以独立 PositionSlot 的 8 个命名字段为准。
  const point = remapped[ids.subQuest].value.find((field) => field.key === "任务调查点预设点");
  if (!point) throw new Error("子任务结构体缺少调查点字段。");
  point.value = {
    param_type: "Struct",
    value: {
      structId: ids.positionSlot, type: "Struct",
      value: remapped[ids.positionSlot].value.map((field) => field.value),
    },
  };
  return new VariableWorkspace(remapped);
}

export interface QuestVariableExportResult {
  files: Array<{ filename: string; value: unknown; json: string }>;
  warnings: string[];
}

export function exportQuestVariables(project: QuestProject): QuestVariableExportResult {
  const errors = validateQuestProject(project);
  if (errors.length) throw new Error(errors.join("；"));
  const ids = project.structIds;
  const workspace = createQuestStructWorkspace(ids);
  const replacements = idReplacements(ids);
  // 变量样例仅提供根字典形状；样例中的演示项/过时字段不能混入项目数据。
  const dictionary = (sample: Record<string, unknown>) => workspace.parse(
    remapIds({ ...sample, value: [] }, replacements) as Parameters<VariableWorkspace["parse"]>[0],
  );
  const chapters = dictionary(chapterVariable);
  const mains = dictionary(mainVariable);
  const subs = dictionary(subVariable);
  const warnings = ["已按独立子任务定义导出 Int32 归属主任务和隐藏任务；调查点暂按独立 PositionSlot 的 8 个字段导出，不含内嵌样例多出的两个未命名 Int32，请确认运行时定义。"];
  const subIds = new Set(project.subQuests.map((sub) => sub.id));
  for (const chapter of [...project.chapters].sort((a, b) => a.id - b.id)) {
    const value = workspace.createDefault(ids.chapter);
    value.value["标题"].setValue(chapter.title);
    chapters.appendItem({ key: String(chapter.id), value });
  }
  for (const main of [...project.mainQuests].sort((a, b) => a.id - b.id)) {
    const value = workspace.createDefault(ids.mainQuest);
    value.value["chapter"].setValue(String(main.chapterId ?? project.unassignedChapterId));
    value.value["title"].setValue(main.title);
    value.value["style"].setValue(main.style);
    mains.appendItem({ key: String(main.id), value });
  }
  const buckets = new Map<number, VariableValue>();
  for (const sub of [...project.subQuests].sort((a, b) => a.id - b.id)) {
    const value = workspace.createDefault(ids.subQuest);
    value.value["mainId"].setValue(String(sub.mainQuestId));
    value.value["title"].setValue(sub.title);
    value.value["desc"].setValue(sub.description);
    value.value["任务单位状态"].setValue(sub.unitState);
    const point = value.value["任务调查点预设点"] as VariableValue;
    for (const [key, field] of Object.entries(point.value)) {
      const parameter = sub.investigationPoint[key];
      (field as VariableValue).setValue(typeof parameter === "boolean" ? parameter ? "True" : "False" : String(parameter));
    }
    value.value["调查点范围"].setValue(String(sub.investigationRange));
    value.value["隐藏任务"].setValue(sub.hidden ? "True" : "False");
    value.value["后续任务"].setValue(sub.nextQuestIds.map((id) => String(id ?? -1)));
    value.value["失败回溯任务"].setValue(String(sub.failureQuestId ?? -1));
    value.value["finishMainQuest"].setValue(sub.finishMainQuest ? "True" : "False");
    value.value["questProgress"].setValue(String(sub.questProgress));
    if (sub.failureQuestId === null) {
      warnings.push(`子任务 ${sub.id}「${sub.title}」的失败回溯任务为空，将按 -1 导出，请确认。`);
    } else if (sub.failureQuestId !== -1 && !subIds.has(sub.failureQuestId)) {
      warnings.push(`子任务 ${sub.id}「${sub.title}」的失败回溯任务（ID ${sub.failureQuestId}）在当前文件中不存在，仍保留原 ID，请确认。`);
    }
    const clearedPositions: number[] = [];
    const missingPositions: string[] = [];
    sub.nextQuestIds.forEach((id, index) => {
      if (id === null) clearedPositions.push(index + 1);
      else if (!subIds.has(id)) missingPositions.push(`第 ${index + 1} 项（ID ${id}）`);
    });
    const referenceWarnings: string[] = [];
    if (clearedPositions.length) referenceWarnings.push(`第 ${clearedPositions.join("、")} 项为空，将按 -1 导出`);
    if (missingPositions.length) referenceWarnings.push(`${missingPositions.join("、")}在当前文件中不存在，仍保留原 ID，请确认`);
    if (referenceWarnings.length) warnings.push(`子任务 ${sub.id}「${sub.title}」的后续任务：${referenceWarnings.join("；")}。`);
    const bucketId = Math.floor(sub.id / 100);
    let bucket = buckets.get(bucketId);
    if (!bucket) {
      bucket = workspace.createDefault(ids.subQuestDictionary);
      buckets.set(bucketId, bucket);
    }
    // 内键必须是完整全局 ID；例如子任务 199 存在外键 1 / 内键 199 下。
    bucket.value["子任务字典"].appendItem({ key: String(sub.id), value });
  }
  for (const [id, bucket] of buckets) subs.appendItem({ key: String(id), value: bucket });
  return {
    files: [
      ["NOLOC_章节配置.json", chapters],
      ["NOLOC_主任务配置.json", mains],
      ["NOLOC_子任务.json", subs],
    ].map(([filename, variable]) => {
      const root = variable as VariableValue;
      if (root.issues.length) throw new Error(`任务变量结构校验失败：${root.issues.map((issue) => issue.message).join("；")}`);
      return { filename: filename as string, value: root.toQxqyValue(), json: root.serialize(2) };
    }),
    warnings,
  };
}
