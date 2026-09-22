import { decodeEntityPresets, encodeEntityPresets } from "./entityPresets";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export function useEntityPresets() {
  return useWorkspacePresets({
    fileName: "EntityPresets.json",
    defaults: () => systemPresetConfig.entities.presets,
    encode: encodeEntityPresets,
    decode: decodeEntityPresets,
  });
}
