import { decodeSkillAnimationPresets, encodeSkillAnimationPresets } from "./skillAnimationPresets";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export function useSkillAnimationPresets() {
  return useWorkspacePresets({
    fileName: "SkillAnimationPresets.json",
    editableDefaults: true,
    fixedFields: ["name"],
    defaults: () => systemPresetConfig.skillAnimations.presets,
    encode: encodeSkillAnimationPresets,
    decode: decodeSkillAnimationPresets,
  });
}

