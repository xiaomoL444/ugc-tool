export interface QuestStructIds {
  chapter: string;
  mainQuest: string;
  subQuest: string;
  subQuestDictionary: string;
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
  investigationPoint: Record<string, unknown>;
  investigationRange: number;
  hidden: boolean;
  nextQuestIds: Array<number | null>;
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
