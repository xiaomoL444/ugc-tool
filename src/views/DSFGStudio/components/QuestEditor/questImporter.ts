import { readRuntime, keyedRows, assertImport } from "../runtimeImport";
import { createQuestProject, DEFAULT_QUEST_STRUCT_IDS, validateQuestProject } from "./questProject";
import { createQuestStructWorkspace } from "./questExporter";

export function importQuest(text: string) {
  const { data, ids } = readRuntime(text, DEFAULT_QUEST_STRUCT_IDS, DEFAULT_QUEST_STRUCT_IDS.configuration, createQuestStructWorkspace(DEFAULT_QUEST_STRUCT_IDS));
  const project = createQuestProject(); project.structIds = ids;
  project.chapters = keyedRows(data["章节"]).map(row => ({ id: Number(row.id), title: row["标题"] }));
  const mains = keyedRows(data["主任务"]);
  const unassigned = [...new Set<number>(mains.map(row => Number(row.chapter)).filter(id => !project.chapters.some(chapter => chapter.id === id)))];
  assertImport(unassigned.length <= 1, "主任务引用了多个不存在的章节，无法确定未归属章节标记");
  if (unassigned.length) project.unassignedChapterId = unassigned[0];
  project.mainQuests = mains.map(row => ({ id: Number(row.id), title: row.title, style: row.style, chapterId: Number(row.chapter) === project.unassignedChapterId ? null : Number(row.chapter) }));
  project.subQuests = data["子任务"].flatMap((bucket: any) => keyedRows(bucket.value["子任务字典"], Number(bucket.key))).map((row: any) => ({
    id: Number(row.id), mainQuestId: Number(row.mainQuestId), title: row.title, description: row.desc,
    unitState: row["任务单位状态"], investigationPoint: row.pos, belondPrimaryId: Number(row.belondPrimaryId),
    investigationRange: Number(row["调查点范围"]), hidden: row["隐藏任务"], nextQuestIds: row["后续任务"].map(Number),
    failureQuestId: Number(row["失败回溯任务"]), finishMainQuest: row.finishMainQuest, questProgress: Number(row.questProgress),
  }));
  const errors = validateQuestProject(project); if (errors.length) throw new Error(errors.join("；"));
  return project;
}
