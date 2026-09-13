import { CAMERA_SLOT_PROPERTIES } from "../DialogueEditor/config/cameraClip";
import { createClipPropertyValues } from "../DialogueEditor/utils/clipProperties";
import type { QuestChapter, QuestMain, QuestProject, QuestStructIds, QuestSub } from "./types";

export const DEFAULT_QUEST_MAIN_STYLE = "Mainline";
export const DEFAULT_QUEST_SUB_FIELDS = {
  failureQuestId: -1, finishMainQuest: false, questProgress: 0,
} as const;

export const DEFAULT_QUEST_STRUCT_IDS: QuestStructIds = {
  chapter: "1077936165", mainQuest: "1077936166", subQuest: "1077936145",
  configuration: "1077936169", positionSlot: "1077936164",
};

export const QUEST_STRUCT_ID_FIELDS: ReadonlyArray<{
  key: keyof QuestStructIds; label: string; description: string;
}> = [
  { key: "configuration", label: "任务配置数据", description: "导出变量的最外层结构体" },
  { key: "chapter", label: "章节", description: "任务配置数据中章节字典的值" },
  { key: "mainQuest", label: "主任务", description: "任务配置数据中主任务字典的值" },
  { key: "subQuest", label: "子任务", description: "子任务字典的列表元素，每桶最多 100 项" },
  { key: "positionSlot", label: "PositionSlot", description: "子任务调查点的位置参数" },
];

export function createQuestProject(): QuestProject {
  return {
    kind: "DSFGQuest", schemaVersion: 1, structIds: { ...DEFAULT_QUEST_STRUCT_IDS },
    unassignedChapterId: -1, chapters: [], mainQuests: [], subQuests: [],
  };
}

function allocateId(items: Array<{ id: number }>, limit: number, label: string): number {
  if (items.length >= limit) throw new Error(`${label}最多支持 ${limit} 个。`);
  const used = new Set(items.map((item) => item.id));
  for (let id = 0; id < limit; id++) if (!used.has(id)) return id;
  throw new Error(`${label}没有可用的 ID。`);
}

export function createQuestChapter(project: QuestProject): QuestChapter {
  const chapter = { id: allocateId(project.chapters, 100, "章节"), title: "新章节" };
  if (chapter.id === project.unassignedChapterId) {
    // 正数未归属标记同样不能被普通章节占用。
    const used = new Set([...project.chapters.map((item) => item.id), project.unassignedChapterId]);
    let id = 0;
    while (used.has(id)) id++;
    chapter.id = id;
  }
  project.chapters.push(chapter);
  return chapter;
}

export function createQuestMain(project: QuestProject, chapterId: number | null = null): QuestMain {
  if (chapterId !== null && !project.chapters.some((chapter) => chapter.id === chapterId)) {
    throw new Error(`章节 ${chapterId} 不存在。`);
  }
  const main: QuestMain = {
    id: allocateId(project.mainQuests, 100, "主任务"), chapterId, title: "新主任务", style: DEFAULT_QUEST_MAIN_STYLE,
  };
  project.mainQuests.push(main);
  return main;
}

export function createQuestSub(project: QuestProject, mainQuestId: number): QuestSub {
  if (!project.mainQuests.some((main) => main.id === mainQuestId)) {
    throw new Error(`主任务 ${mainQuestId} 不存在。`);
  }
  const sub: QuestSub = {
    id: allocateId(project.subQuests, 10000, "子任务"), mainQuestId, title: "新子任务",
    description: "", unitState: "0", investigationPoint: createClipPropertyValues(CAMERA_SLOT_PROPERTIES),
    investigationRange: -1, hidden: false, nextQuestIds: [],
    ...DEFAULT_QUEST_SUB_FIELDS,
  };
  project.subQuests.push(sub);
  return sub;
}

/** 删除实际存在的子任务并清空剩余任务中的引用，保留引用位置及其他任务的 ID。 */
export function removeQuestSubQuests(project: QuestProject, ids: ReadonlySet<number>): {
  removedCount: number; clearedReferenceCount: number;
} {
  const removedIds = new Set(project.subQuests.filter((sub) => ids.has(sub.id)).map((sub) => sub.id));
  if (!removedIds.size) return { removedCount: 0, clearedReferenceCount: 0 };
  const remaining = project.subQuests.filter((sub) => !removedIds.has(sub.id));
  let clearedReferenceCount = 0;
  for (const sub of remaining) {
    sub.nextQuestIds.forEach((id, index) => {
      if (id !== null && removedIds.has(id)) {
        sub.nextQuestIds[index] = null;
        clearedReferenceCount++;
      }
    });
    if (sub.failureQuestId !== null && removedIds.has(sub.failureQuestId)) {
      sub.failureQuestId = null;
      clearedReferenceCount++;
    }
  }
  const removedCount = project.subQuests.length - remaining.length;
  project.subQuests = remaining;
  return { removedCount, clearedReferenceCount };
}

export function encodeQuestProject(project: QuestProject): string {
  // 内部编辑状态按原样保存，包括清空输入框或尚未输完的 GUID/坐标草稿。
  // 能否交给千星运行时由导出校验决定，不能阻止用户保存编辑中的值。
  return JSON.stringify(project, null, 2);
}

export function decodeQuestProject(raw: string): QuestProject {
  let project: QuestProject;
  try { project = JSON.parse(raw); } catch { throw new Error("任务文件不是有效的 JSON。"); }
  // 旧工程只补缺失字段；已填的样式、空字符串和后续任务空位都按原样保留。
  if (record(project) && project.kind === "DSFGQuest" && project.schemaVersion === 1) {
    if (record(project.structIds)) {
      // 旧分桶结构体已停用；其自定义 ID 不能当作新配置结构体 ID 复用。
      if (!Object.prototype.hasOwnProperty.call(project.structIds, "configuration")) project.structIds.configuration = DEFAULT_QUEST_STRUCT_IDS.configuration;
      delete (project.structIds as unknown as Record<string, unknown>).subQuestDictionary;
    }
    if (Array.isArray(project.mainQuests)) for (const main of project.mainQuests) {
      if (record(main) && !Object.prototype.hasOwnProperty.call(main, "style")) main.style = DEFAULT_QUEST_MAIN_STYLE;
    }
    if (Array.isArray(project.subQuests)) for (const sub of project.subQuests) {
      if (!record(sub)) continue;
      if (!Object.prototype.hasOwnProperty.call(sub, "nextQuestIds")) sub.nextQuestIds = [];
      for (const key of Object.keys(DEFAULT_QUEST_SUB_FIELDS) as Array<keyof typeof DEFAULT_QUEST_SUB_FIELDS>) {
        if (!Object.prototype.hasOwnProperty.call(sub, key)) Object.assign(sub, { [key]: DEFAULT_QUEST_SUB_FIELDS[key] });
      }
    }
  }
  assertValidProject(project, { allowDraftValues: true });
  return project;
}

interface QuestValidationOptions { allowDraftValues?: boolean }

function assertValidProject(project: QuestProject, options: QuestValidationOptions = {}) {
  const errors = validateQuestProject(project, options);
  if (errors.length) throw new Error(errors.join("；"));
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const int32 = (value: unknown): value is number => typeof value === "number" &&
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const integerText = (value: unknown): value is string => typeof value === "string" && /^[+-]?\d+$/.test(value);
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function vector3(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(",").map((part) => part.trim());
  return parts.length === 3 && parts.every((part) => numberPattern.test(part) && Number.isFinite(Number(part)));
}

/** 默认严格校验导出值；草稿导入仅放宽数值文本，仍检查文档类型、ID 和父引用。 */
export function validateQuestProject(project: QuestProject, options: QuestValidationOptions = {}): string[] {
  const errors: string[] = [];
  if (!record(project)) return ["任务文件必须是对象。"];
  if (project.kind !== "DSFGQuest" || project.schemaVersion !== 1) errors.push("不是支持的任务文件格式（DSFGQuest v1）。");
  if (!record(project.structIds)) errors.push("缺少结构体 ID 设置。");
  else {
    const used = new Map<string, string>();
    for (const field of QUEST_STRUCT_ID_FIELDS) {
      const id = project.structIds[field.key];
      if (typeof id !== "string" || !/^\d+$/.test(id)) { errors.push(`${field.label}结构体 ID 必须是数字文本。`); continue; }
      const canonical = id.replace(/^0+(?=\d)/, "");
      if (used.has(canonical)) errors.push(`${field.label}与${used.get(canonical)}不能使用相同结构体 ID。`);
      else used.set(canonical, field.label);
    }
  }
  if (!int32(project.unassignedChapterId)) errors.push("未归属章节标记必须是 Int32 整数。");
  if (!Array.isArray(project.chapters) || !Array.isArray(project.mainQuests) || !Array.isArray(project.subQuests)) {
    errors.push("chapters、mainQuests 和 subQuests 必须是列表。");
    return errors;
  }
  function checkItems(items: unknown[], label: string, limit: number, maxId = 2147483647): Set<number> {
    if (items.length > limit) errors.push(`${label}最多支持 ${limit} 个。`);
    const ids = new Set<number>();
    items.forEach((item, index) => {
      if (!record(item)) { errors.push(`${label}第 ${index + 1} 项必须是对象。`); return; }
      if (!int32(item.id) || item.id < 0 || item.id > maxId) errors.push(`${label}第 ${index + 1} 项 ID 必须是 0 至 ${maxId} 的整数。`);
      else if (ids.has(item.id)) errors.push(`${label} ID ${item.id} 重复。`);
      else ids.add(item.id);
      if (typeof item.title !== "string") errors.push(`${label} ${item.id} 的标题必须是文本。`);
    });
    return ids;
  }
  const chapterIds = checkItems(project.chapters, "章节", 100);
  const mainIds = checkItems(project.mainQuests, "主任务", 100);
  checkItems(project.subQuests, "子任务", 10000, 9999);
  if (chapterIds.has(project.unassignedChapterId)) errors.push("未归属章节标记不能与现有章节 ID 相同。");
  project.mainQuests.forEach((main) => {
    if (!record(main)) return;
    if (typeof main.style !== "string") errors.push(`主任务 ${main.id} 的样式必须是文本。`);
    if (main.chapterId !== null && (!int32(main.chapterId) || !chapterIds.has(main.chapterId))) {
      errors.push(`主任务 ${main.id} 引用的章节 ${main.chapterId} 不存在。`);
    }
  });
  project.subQuests.forEach((sub) => {
    if (!record(sub)) return;
    const label = `子任务 ${sub.id}`;
    if (!int32(sub.mainQuestId) || !mainIds.has(sub.mainQuestId)) errors.push(`${label}引用的主任务 ${sub.mainQuestId} 不存在。`);
    if (typeof sub.description !== "string") errors.push(`${label}描述必须是文本。`);
    if (typeof sub.unitState !== "string" || (!options.allowDraftValues && !integerText(sub.unitState))) errors.push(`${label}任务单位状态必须是 ConfigReference 整数文本。`);
    if (typeof sub.investigationRange !== "number" || !Number.isFinite(sub.investigationRange)) errors.push(`${label}调查点范围必须是有限数值。`);
    if (typeof sub.hidden !== "boolean") errors.push(`${label}隐藏任务必须是布尔值。`);
    if (sub.failureQuestId !== null && !int32(sub.failureQuestId)) errors.push(`${label}失败回溯任务必须是 Int32 整数或空值。`);
    if (typeof sub.finishMainQuest !== "boolean") errors.push(`${label}完成主任务必须是布尔值。`);
    if (!int32(sub.questProgress)) errors.push(`${label}任务进度必须是 Int32 整数。`);
    if (!Array.isArray(sub.nextQuestIds) || sub.nextQuestIds.length > 100 || sub.nextQuestIds.some((id) => id !== null && !int32(id))) {
      errors.push(`${label}后续任务必须是最多 100 项的 Int32 整数或空值列表。`);
    }
    const slot = sub.investigationPoint;
    if (!record(slot)) { errors.push(`${label}调查点必须是 PositionSlot 参数对象。`); return; }
    if (slot.space !== 0 && slot.space !== 1) errors.push(`${label}坐标空间只能是 Local（0）或 World（1）。`);
    if (!["Vector3", "Guid", "Entity"].includes(String(slot.pointType))) errors.push(`${label}点位类型必须是 Vector3、Guid 或 Entity。`);
    for (const key of ["vector3", "offset"]) if (typeof slot[key] !== "string" || (!options.allowDraftValues && !vector3(slot[key]))) errors.push(`${label} ${key} 必须是三个逗号分隔的有限数值。`);
    if (typeof slot.guid !== "string" || (!options.allowDraftValues && !integerText(slot.guid))) errors.push(`${label} GUID 必须是整数文本。`);
    for (const key of ["entity", "attachmentPoint"]) if (typeof slot[key] !== "string") errors.push(`${label} ${key} 必须是文本。`);
    if (typeof slot.requiresClientPos !== "boolean") errors.push(`${label} requiresClientPos 必须是布尔值。`);
  });
  return errors;
}
