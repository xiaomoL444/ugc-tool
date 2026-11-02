import { isWorkspaceFileType, WorkspaceFileType, type WorkspaceTarget } from "./versioning/types";
import { assertWorkspaceTarget, cloneWorkspaceTarget, resolveBaseRelease } from "./versioning/catalog";
import { legacyBaseReleaseId, latestBaseReleaseId } from "./versioning/baseReleases";

export { cloneWorkspaceTarget, workspaceTargetKey } from "./versioning/catalog";
export type { WorkspaceTarget } from "./versioning/types";

export const WORKSPACE_SETTINGS_FILE = "WorkspaceSettings.json";
export interface WorkspaceSettings extends WorkspaceTarget { kind: "DSFGWorkspaceSettings"; schemaVersion: 3 }

/** Historical source IDs are used only while decoding formats 1/2, never as a live catalogue. */
const legacyTemplateBaseIds: Readonly<Record<number, number>> = { 1: 1, 2: 2 };
function migrateLegacyTemplateId(value: unknown): number {
  if (!Number.isSafeInteger(value) || !Object.prototype.hasOwnProperty.call(legacyTemplateBaseIds, value as number)) {
    throw new Error(`未知的旧模版版本 ID：${String(value)}，原文件已保留。`);
  }
  return legacyTemplateBaseIds[value as number];
}

/** Missing legacy settings use the original map / 7.1 target, without rewriting old files. */
export function createWorkspaceSettings(target: WorkspaceTarget = resolveBaseRelease(legacyBaseReleaseId, WorkspaceFileType.BeyondMap)): WorkspaceSettings {
  return decodeWorkspaceSettings({ kind: "DSFGWorkspaceSettings", schemaVersion: 3, ...cloneWorkspaceTarget(target) });
}

export function createNewWorkspaceSettings(): WorkspaceSettings {
  return createWorkspaceSettings(resolveBaseRelease(latestBaseReleaseId, WorkspaceFileType.BeyondMap));
}

export function decodeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const data = value as Record<string, unknown> | null;
  if (!data || data.kind !== "DSFGWorkspaceSettings" || !isWorkspaceFileType(data.fileType)) {
    throw new Error("工作区设置格式无效，原文件已保留。");
  }
  if (data.schemaVersion === 1) {
    return createWorkspaceSettings(resolveBaseRelease(migrateLegacyTemplateId(data.templateReleaseId), data.fileType));
  }
  if ((data.schemaVersion !== 2 && data.schemaVersion !== 3)
    || (data.baseReleaseId !== null && !Number.isSafeInteger(data.baseReleaseId))
    || !Array.isArray(data.packageIds) || !data.packageIds.every(id => Number.isSafeInteger(id))) {
    throw new Error("工作区设置格式无效，原文件已保留。");
  }
  // Explicit baselines win over old provenance. Early format-2 files may only have an assigned source.
  const baseReleaseId = data.schemaVersion === 2 && data.baseReleaseId === null && data.sourceTemplateReleaseId !== undefined
    ? migrateLegacyTemplateId(data.sourceTemplateReleaseId) : data.baseReleaseId as number | null;
  // Empty legacy selections use the original 2.0 baseline; saved settings always name a baseline.
  const target = cloneWorkspaceTarget({ fileType: data.fileType, baseReleaseId: baseReleaseId ?? legacyBaseReleaseId, packageIds: [...data.packageIds] });
  assertWorkspaceTarget(target);
  return { kind: "DSFGWorkspaceSettings", schemaVersion: 3, ...target };
}

export function encodeWorkspaceSettings(settings: WorkspaceSettings): string {
  return JSON.stringify(decodeWorkspaceSettings(settings), null, 2);
}

export async function loadWorkspaceSettings(storage: { exists(path: string): Promise<boolean>; readFile(path: string): Promise<string> }, workspace: string): Promise<WorkspaceSettings> {
  const path = `/${workspace}/${WORKSPACE_SETTINGS_FILE}`;
  return await storage.exists(path) ? decodeWorkspaceSettings(JSON.parse(await storage.readFile(path))) : createWorkspaceSettings();
}

export function workspaceNameError(name: string, workspaces: string[], current = ""): string {
  const value = name.trim();
  if (!value) return "工作区名称不可为空";
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) return "工作区名称不能包含路径或特殊字符";
  if (workspaces.some(id => id !== current && id.toLocaleLowerCase() === value.toLocaleLowerCase())) return "已有相同名称的工作区，无法重复添加";
  return "";
}
