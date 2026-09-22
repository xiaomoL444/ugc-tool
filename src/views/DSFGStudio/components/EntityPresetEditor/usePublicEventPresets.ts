import { decodePublicEventPresets, encodePublicEventPresets } from "./publicEventPresets";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export function usePublicEventPresets() {
  return useWorkspacePresets({
    fileName: "PublicEventPresets.json",
    defaults: () => systemPresetConfig.publicEvents.presets,
    encode: encodePublicEventPresets,
    decode: decodePublicEventPresets,
  });
}

