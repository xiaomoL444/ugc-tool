import { systemPresetConfig } from "./EntityPresetEditor/systemPresetConfig";
import { encodeSkillAnimationPresets, isSkillAnimationApplicable } from "./EntityPresetEditor/skillAnimationPresets";
import type { importGilWorkspaceIds } from "./gilSkillAnimations";
import { createWorkspaceStructIds, encodeWorkspaceStructIds, WORKSPACE_STRUCT_ID_FIELDS, WORKSPACE_STRUCT_IDS_FILE } from "./workspaceStructIds";
import { isWorkspaceStructGroupAvailable } from "./workspaceFeatures";
import { cloneWorkspaceTarget, type WorkspaceTarget } from "./workspaceSettings";

export type WorkspaceGilResult = ReturnType<typeof importGilWorkspaceIds>;
export interface WorkspaceGilCalibration {
  fileName: string;
  target: WorkspaceTarget;
  result: WorkspaceGilResult;
  structSelections: Record<string, string>;
  skillSelections: Record<string, string>;
}

export function createWorkspaceGilCalibration(fileName: string, result: WorkspaceGilResult, target: WorkspaceTarget): WorkspaceGilCalibration {
  const visibleKeys = new Set(WORKSPACE_STRUCT_ID_FIELDS.filter(field => isWorkspaceStructGroupAvailable(field.group, target)).map(field => field.key));
  const structs = { ...result.structs,
    matched: result.structs.matched.filter(key => visibleKeys.has(key)),
    missing: result.structs.missing.filter(key => visibleKeys.has(key)),
    ambiguous: result.structs.ambiguous.filter(key => visibleKeys.has(key)),
  };
  if (!structs.matched.length && !structs.ambiguous.length && !result.skills.matched.length && !result.skills.ambiguous.length) {
    throw new Error("未找到适用于当前文件类型的 DSFG 结构体或技能动画，请确认 GIL 存档内容。");
  }
  return { fileName, target: cloneWorkspaceTarget(target), result: { structs, skills: result.skills }, structSelections: {}, skillSelections: {} };
}

export async function readWorkspaceGilCalibration(file: File, input: WorkspaceTarget): Promise<WorkspaceGilCalibration> {
  const target = cloneWorkspaceTarget(input);
  if (!/\.gil$/i.test(file.name)) throw new Error("请选择 .gil 存档文件。");
  if (file.size > 100 * 1024 * 1024) throw new Error("GIL 文件超过 100 MB，请选择较小的存档。");
  const { importGilWorkspaceIds } = await import("./gilSkillAnimations");
  const presets = systemPresetConfig.skillAnimations.presets.filter(preset => isSkillAnimationApplicable(preset.id, target))
    .map(({ id, name, configId }) => ({ id, name, configId }));
  const result = importGilWorkspaceIds(await file.arrayBuffer(), createWorkspaceStructIds(), presets);
  return createWorkspaceGilCalibration(file.name, result, target);
}

/** Only decoded parameter overrides are persisted. The archive bytes are never stored or uploaded. */
export function workspaceGilCalibrationFiles(calibration: WorkspaceGilCalibration): Record<string, string> {
  const { result, structSelections, skillSelections } = calibration;
  const ids = { ...result.structs.ids };
  for (const key of result.structs.ambiguous) {
    const id = structSelections[key];
    if (!result.structs.candidates[key].some(candidate => candidate.id === id)) throw new Error("请先选择存在同名候选的结构体 ID。");
    ids[key] = id;
  }
  const presets = result.skills.presets.map(preset => {
    if (!result.skills.ambiguous.includes(preset.id)) return { ...preset };
    const configId = skillSelections[preset.id];
    if (!result.skills.candidates[preset.id].some(candidate => candidate.id === configId)) throw new Error("请先选择存在同名候选的技能动画 ID。");
    return { ...preset, configId };
  });
  const defaults = new Map(systemPresetConfig.skillAnimations.presets.map(preset => [preset.id, preset]));
  const skillData = JSON.parse(encodeSkillAnimationPresets([]));
  skillData.presetStorage = "system-overrides";
  skillData.systemOverrides = presets.filter(preset => preset.configId !== defaults.get(preset.id)?.configId);
  return { [WORKSPACE_STRUCT_IDS_FILE]: encodeWorkspaceStructIds(ids, calibration.target), "SkillAnimationPresets.json": JSON.stringify(skillData, null, 2) };
}
