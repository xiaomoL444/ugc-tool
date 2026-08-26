export interface EffectItem {
  id: string;
  title?: string;
  name?: string;
  duration: number;
  isLoop: boolean;
  tagList: number[];
  icon: string;
}

export interface EffectDataFile {
  effectData: Record<string, EffectItem>;
  TagData: Record<string, string>;
}

export type EffectLoopFilter = "all" | "once" | "loop";

export interface EffectRow {
  id: string;
  data: EffectItem[];
}
