export interface EffectItem {
  id: string;
  /** Preferred full resource key; old title/name keys are normalized by the client. */
  nameI18nKey?: string;
  title?: string;
  name?: string;
  /** Original names remain searchable when title/name contain translation keys. */
  sourceTitle?: string;
  sourceName?: string;
  duration: number;
  isLoop: boolean;
  tagList: number[];
  icon: string;
  standPath?: string;
  tailPath?: string;
  hasAudio?: boolean;
  audioPath?: string;
  giVersion?: string;
}

export interface EffectDataFile {
  effectData: Record<string, EffectItem>;
  TagData: Record<string, string>;
  /** Original tag labels for searching alongside translated labels. */
  sourceTagData?: Record<string, string>;
  category?: Record<string, number[]>;
  /** Stable category IDs mapped to original labels; IDs survive reordering. */
  sourceCategoryData?: Record<string, string>;
}

export type EffectLoopFilter = "all" | "once" | "loop";

export interface EffectRow {
  id: string;
  data: EffectItem[];
}
