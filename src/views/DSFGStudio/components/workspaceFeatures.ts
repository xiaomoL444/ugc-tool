import { WorkspaceFileType } from "./versioning/types";
import { cloneWorkspaceTarget, getBaseRelease, isInVersionRanges } from "./versioning/catalog";
import { baseReleases } from "./versioning/baseReleases";
import { extensionPackages } from "./versioning/extensionPackages";
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
  // Keep rules for future content while its catalogue entries are commented out for publication.
  // A range with an unavailable bound cannot establish applicability; other ranges still apply.
  const ranges = rule.baseVersionRanges?.filter(range => [range.min, range.max]
    .every(bound => !bound || baseReleases.some(base => base.id === bound.releaseId)));
  if (ranges && (!ranges.length || target.baseReleaseId === null || !isInVersionRanges(
    getBaseRelease(target.baseReleaseId).order, ranges, id => getBaseRelease(id).order))) return false;
  if (rule.requiredPackageIds && !rule.requiredPackageIds.every(id =>
    extensionPackages.some(extension => extension.id === id) && target.packageIds.includes(id))) return false;
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
