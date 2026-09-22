import { VariableValue, VariableWorkspace, type StructDefinition } from "miliastra-variable";
import chapterDefinition from "@/assets/DSFGStudio/Quest/1077936165[任务]章节.json";
import mainDefinition from "@/assets/DSFGStudio/Quest/1077936166[任务]主任务.json";
import subDefinition from "@/assets/DSFGStudio/Quest/1077936145[任务]子任务.json";
import configurationDefinition from "@/assets/DSFGStudio/Quest/1077936169[任务]任务配置数据.json";
import subDictionaryDefinition from "@/assets/DSFGStudio/Quest/1077936170[任务]子任务字典.json";
import { DEFAULT_QUEST_STRUCT_IDS, QUEST_STRUCT_ID_FIELDS, validateQuestProject } from "./questProject";
import type { QuestProject, QuestStructIds } from "./types";

export { QUEST_STRUCT_ID_FIELDS } from "./questProject";

const definitions: Record<Exclude<keyof QuestStructIds, "positionSlot">, StructDefinition> = {
  chapter: chapterDefinition as StructDefinition,
  mainQuest: mainDefinition as StructDefinition,
  subQuest: subDefinition as StructDefinition,
  configuration: configurationDefinition as StructDefinition,
  subQuestDictionary: subDictionaryDefinition as StructDefinition,
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
    ids[key], remapIds(definitions[key as Exclude<keyof QuestStructIds, "positionSlot">], replacements) as StructDefinition,
  ]));
  // 配置定义中的示例条目只说明类型；不能混入实际任务或过时的内嵌样例。
  for (const field of remapped[ids.configuration].value) {
    const dictionary = field.value.value as { value: unknown[] };
    dictionary.value = [];
  }
  const subDictionary = remapped[ids.subQuestDictionary].value.find((field) => field.key === "子任务字典");
  if (!subDictionary) throw new Error("子任务字典结构体缺少子任务字典字段。");
  (subDictionary.value.value as { value: unknown[] }).value = [];
  return new VariableWorkspace(remapped);
}

export interface QuestVariableExportResult {
  value: unknown;
  json: string;
  warnings: string[];
}

export function exportQuestVariables(project: QuestProject): QuestVariableExportResult {
  const errors = validateQuestProject(project);
  if (errors.length) throw new Error(errors.join("；"));
  const ids = project.structIds;
  const workspace = createQuestStructWorkspace(ids);
  const configuration = workspace.createDefault(ids.configuration);
  const chapters = configuration.value["章节"] as VariableValue;
  const mains = configuration.value["主任务"] as VariableValue;
  const subs = configuration.value["子任务"] as VariableValue;
  const warnings: string[] = [];
  const subIds = new Set(project.subQuests.map((sub) => sub.id));
  for (const chapter of [...project.chapters].sort((a, b) => a.id - b.id)) {
    const value = workspace.createDefault(ids.chapter);
    value.value["id"].setValue(String(chapter.id));
    value.value["标题"].setValue(chapter.title);
    chapters.appendItem({ key: String(chapter.id), value });
  }
  for (const main of [...project.mainQuests].sort((a, b) => a.id - b.id)) {
    const value = workspace.createDefault(ids.mainQuest);
    value.value["id"].setValue(String(main.id));
    value.value["chapter"].setValue(String(main.chapterId ?? project.unassignedChapterId));
    value.value["title"].setValue(main.title);
    value.value["style"].setValue(main.style);
    mains.appendItem({ key: String(main.id), value });
  }
  const buckets = new Map<number, VariableValue>();
  for (const sub of [...project.subQuests].sort((a, b) => a.id - b.id)) {
    const value = workspace.createDefault(ids.subQuest);
    value.value["id"].setValue(String(sub.id));
    value.value["mainQuestId"].setValue(String(sub.mainQuestId));
    value.value["title"].setValue(sub.title);
    value.value["desc"].setValue(sub.description);
    value.value["任务单位状态"].setValue(sub.unitState);
    value.value["pos"].setValue(sub.investigationPoint);
    value.value["belondSceneId"].setValue(String(sub.belondSceneId));
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
    // 内层键使用完整 ID（例如桶 1 的键为 100–199），不取余、不因删除重新编号。
    (bucket.value["子任务字典"] as VariableValue).appendItem({ key: String(sub.id), value });
  }
  for (const [id, bucket] of buckets) subs.appendItem({ key: String(id), value: bucket });
  if (configuration.issues.length) throw new Error(`任务变量结构校验失败：${configuration.issues.map((issue) => issue.message).join("；")}`);
  return { value: configuration.toQxqyValue(), json: configuration.serialize(2), warnings };
}
