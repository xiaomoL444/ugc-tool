import { decodeSaveModules, encodeSaveModules } from "./saveModules";
import { systemPresetConfig } from "./systemPresetConfig";
import { useWorkspacePresets } from "./useWorkspacePresets";

export function useSaveModules() {
  return useWorkspacePresets({
    fileName: "SaveModules.json",
    defaults: () => systemPresetConfig.saveModules.presets,
    encode: encodeSaveModules,
    decode: decodeSaveModules,
  });
}
