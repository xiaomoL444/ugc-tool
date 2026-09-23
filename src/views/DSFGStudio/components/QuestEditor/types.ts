export interface QuestStructIds {
  chapter: string;
  mainQuest: string;
  subQuest: string;
  subQuestDictionary: string;
  configuration: string;
  positionSlot: string;
}

export interface QuestChapter { id: number; title: string }
export interface QuestMain { id: number; chapterId: number | null; title: string; style: string }
export interface QuestSub {
  id: number;
  mainQuestId: number;
  title: string;
  description: string;
  unitState: string;
  investigationPoint: string;
  legacyInvestigationPoint?: Record<string, unknown>;
  belondSceneId: number;
  investigationRange: number;
  hidden: boolean;
  nextQuestIds: Array<number | null>;
  /** -1 是默认标记；null 表示主动清空或目标被删除，导出时需警告。 */
  failureQuestId: number | null;
  finishMainQuest: boolean;
  questProgress: number;
}

/** 层级关系与字典分桶解耦；ID 不随排序、改名或移动父级改变。 */
export interface QuestProject {
  kind: "DSFGQuest";
  schemaVersion: 1;
  structIds: QuestStructIds;
  unassignedChapterId: number;
  chapters: QuestChapter[];
  mainQuests: QuestMain[];
  subQuests: QuestSub[];
}

export type QuestSelection = { kind: "chapter" | "main" | "sub"; id: number };
