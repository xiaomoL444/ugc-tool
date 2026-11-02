import { computed } from "vue";
import { decodePublicEventPresets, encodePublicEventPresets, isPublicEventApplicable } from "./publicEventPresets";
import { useWorkspaceSettings } from "../useWorkspaceSettings";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export function usePublicEventPresets() {
  const target = useWorkspaceSettings();
  const state = useWorkspacePresets({
    fileName: "PublicEventPresets.json",
    editableDefaults: true,
    fixedFields: ["alias"],
    defaults: () => systemPresetConfig.publicEvents.presets,
    encode: encodePublicEventPresets,
    decode: decodePublicEventPresets,
  });
  // Filter display candidates while retaining all rows for persistence, imports and history.
  const visibleSystemPresets = computed(() => state.systemPresets.value.filter(preset => isPublicEventApplicable(preset.id, target.value)));
  const availablePresets = computed(() => state.availablePresets.value.filter(preset => isPublicEventApplicable(preset.id, target.value)));
  return { ...state, visibleSystemPresets, availablePresets };
}

