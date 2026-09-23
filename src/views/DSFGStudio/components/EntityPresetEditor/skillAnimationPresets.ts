import { systemPresetConfig } from "./systemPresetConfig";

export interface SkillAnimationPreset {
  id: string;
  name: string;
  configId: string;
}

export function createSkillAnimationPreset(): SkillAnimationPreset {
  return { ...systemPresetConfig.skillAnimations.newItem, id: crypto.randomUUID() };
}

/** Keep unfinished IDs as text in drafts; only valid nonnegative Int32 IDs can be applied. */
export function getSkillAnimationConfigId(preset: SkillAnimationPreset): number | null {
  const raw = preset.configId.trim();
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isInteger(value) && value <= 2147483647 ? value : null;
}

export function encodeSkillAnimationPresets(presets: SkillAnimationPreset[]): string {
  return JSON.stringify({ kind: "DSFGSkillAnimationPresets", schemaVersion: 1, presets }, null, 2);
}

export function decodeSkillAnimationPresets(raw: string): SkillAnimationPreset[] {
  const data = JSON.parse(raw);
  if (data?.kind !== "DSFGSkillAnimationPresets" || data.schemaVersion !== 1 || !Array.isArray(data.presets)) {
    throw new Error("无法识别技能动画预设文件，原文件已保留。");
  }
  const ids = new Set<string>();
  return data.presets.map((item: SkillAnimationPreset) => {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)
      || typeof item.name !== "string" || typeof item.configId !== "string") {
      throw new Error("技能动画预设数据不完整，原文件已保留。");
    }
    ids.add(item.id);
    return { id: item.id, name: item.name, configId: item.configId };
  });
}
