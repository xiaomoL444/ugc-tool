import { computed } from "vue";
import { decodeSkillAnimationPresets, encodeSkillAnimationPresets, isSkillAnimationApplicable } from "./skillAnimationPresets";
import { useWorkspaceSettings } from "../useWorkspaceSettings";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export function useSkillAnimationPresets() {
  const target = useWorkspaceSettings();
  const state = useWorkspacePresets({
    fileName: "SkillAnimationPresets.json",
    editableDefaults: true,
    fixedFields: ["name"],
    defaults: () => systemPresetConfig.skillAnimations.presets,
    encode: encodeSkillAnimationPresets,
    decode: decodeSkillAnimationPresets,
  });
  // Keep the complete editable state for persistence, imports and history.
  const visibleSystemPresets = computed(() => state.systemPresets.value.filter(preset => isSkillAnimationApplicable(preset.id, target.value)));
  const availablePresets = computed(() => state.availablePresets.value.filter(preset => isSkillAnimationApplicable(preset.id, target.value)));
  return { ...state, visibleSystemPresets, availablePresets };
}

