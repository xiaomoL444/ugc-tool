import { WorkspaceFileType } from "./versioning/types";
import { cloneWorkspaceTarget, getBaseRelease, getExtensionPackage, isInVersionRanges } from "./versioning/catalog";
import type { WorkspaceTarget, VersionRange } from "./versioning/types";

export interface Applicability {
  fileTypes?: readonly WorkspaceFileType[];
  baseVersionRanges?: readonly VersionRange[];
  requiredPackageIds?: readonly number[];
}

/** File types are alternatives; version intervals are alternatives; the two conditions combine. */
export function isApplicable(rule: Applicability | undefined, input: WorkspaceTarget): boolean {
  if (!rule) return true;
  const target = cloneWorkspaceTarget(input);
  if (rule.fileTypes && !rule.fileTypes.includes(target.fileType)) return false;
  if (rule.baseVersionRanges && (target.baseReleaseId === null || !isInVersionRanges(
    getBaseRelease(target.baseReleaseId).order, rule.baseVersionRanges, id => getBaseRelease(id).order))) return false;
  if (rule.requiredPackageIds && !rule.requiredPackageIds.map(id => {
    getExtensionPackage(id);
    return target.packageIds.includes(id);
  }).every(Boolean)) return false;
  return true;
}

const mapOnly: Applicability = { fileTypes: [WorkspaceFileType.BeyondMap] };
/** Add new feature restrictions here; currently both baselines use the same file-type rules. */
export const workspaceFeatureRules: Readonly<Record<string, Applicability | undefined>> = {
  Quest: mapOnly,
  Scene: mapOnly,
  questStyles: mapOnly,
  multilingualTexts: mapOnly,
  saveModules: mapOnly,
};

export function isWorkspaceFeatureAvailable(feature: string, target: WorkspaceTarget): boolean {
  return isApplicable(workspaceFeatureRules[feature], target);
}

export function isWorkspaceStructGroupAvailable(group: string, target: WorkspaceTarget): boolean {
  return isWorkspaceFeatureAvailable(group === "任务" ? "Quest" : group === "场景" ? "Scene" : group, target);
}
