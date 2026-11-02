import { baseReleases } from "./baseReleases";
import { extensionPackages } from "./extensionPackages";
import { isWorkspaceFileType, type WorkspaceFileType, type WorkspaceTarget, type VersionRange } from "./types";

export function getBaseRelease(id: number) {
  const release = baseReleases.find(item => item.id === id);
  if (!release) throw new Error(`未知的基准版本 ID：${id}`);
  return release;
}

export function getExtensionPackage(id: number) {
  const extension = extensionPackages.find(item => item.id === id);
  if (!extension) throw new Error(`未知的扩展包 ID：${id}`);
  return extension;
}

export function getBasePackageIds(baseReleaseId: number | null): readonly number[] {
  if (baseReleaseId === null) return [];
  const ids = getBaseRelease(baseReleaseId).packageIds;
  if (new Set(ids).size !== ids.length) throw new Error("基准自带扩展包不能重复配置。");
  for (const id of ids) getExtensionPackage(id);
  return [...ids];
}

/** Preserve explicit duplicates for validation, and append only missing baseline-owned packages. */
export function withBasePackages(target: WorkspaceTarget): WorkspaceTarget {
  const included = getBasePackageIds(target.baseReleaseId);
  return { ...target, packageIds: [...target.packageIds, ...included.filter(id => !target.packageIds.includes(id))] };
}

/** Retain optional selections, but stop carrying packages supplied only by the previous baseline. */
export function changeWorkspaceBase(target: WorkspaceTarget, baseReleaseId: number | null): WorkspaceTarget {
  const previous = getBasePackageIds(target.baseReleaseId);
  return withBasePackages({ ...target, baseReleaseId, packageIds: target.packageIds.filter(id => !previous.includes(id)) });
}

export function resolveBaseRelease(id: number, fileType: WorkspaceFileType): WorkspaceTarget {
  getBaseRelease(id);
  // A form may temporarily contain an incompatible combination; validate before saving.
  return withBasePackages({ fileType, baseReleaseId: id, packageIds: [] });
}

export function cloneWorkspaceTarget(target: WorkspaceTarget): WorkspaceTarget {
  return withBasePackages({ fileType: target.fileType,
    baseReleaseId: target.baseReleaseId, packageIds: [...target.packageIds] });
}

/** Package order does not change the target; fresh arrays on parent renders do not invalidate reads. */
export function workspaceTargetKey(input: WorkspaceTarget): string {
  const target = cloneWorkspaceTarget(input);
  return JSON.stringify([target.fileType, target.baseReleaseId, [...target.packageIds].sort((a, b) => a - b)]);
}

/** Bounds refer to stable IDs, but comparisons always use the corresponding directory order. */
export function isInVersionRanges(order: number, ranges: readonly VersionRange[], getOrder: (id: number) => number): boolean {
  if (!ranges.length) throw new Error("版本范围不能为空。");
  return ranges.map(range => {
    if (!range.min && !range.max) throw new Error("版本范围必须设置边界。");
    for (const bound of [range.min, range.max]) {
      if (bound && (!Number.isSafeInteger(bound.releaseId) || typeof bound.inclusive !== "boolean")) throw new Error("版本范围边界无效。");
    }
    const min = range.min && getOrder(range.min.releaseId), max = range.max && getOrder(range.max.releaseId);
    if (min !== undefined && max !== undefined && (min > max || (min === max && (!range.min!.inclusive || !range.max!.inclusive)))) {
      throw new Error("版本范围上下界无效。");
    }
    return (min === undefined || (range.min!.inclusive ? order >= min : order > min))
      && (max === undefined || (range.max!.inclusive ? order <= max : order < max));
  }).some(Boolean);
}

export function workspaceTargetErrors(target: WorkspaceTarget): string[] {
  const errors: string[] = [];
  if (!isWorkspaceFileType(target.fileType)) errors.push("项目文件类型无效。");
  try {
    if (target.baseReleaseId !== null) {
      const base = getBaseRelease(target.baseReleaseId);
      if (base.fileTypes && !base.fileTypes.includes(target.fileType)) errors.push("所选基准版本不适用于当前文件类型。");
      for (const id of getBasePackageIds(target.baseReleaseId)) {
        if (!target.packageIds.includes(id)) errors.push(`基准自带的「${getExtensionPackage(id).name}」必须启用。`);
      }
    }
    if (new Set(target.packageIds).size !== target.packageIds.length) errors.push("扩展包不能重复选择。");
    for (const id of target.packageIds) {
      const extension = getExtensionPackage(id);
      if (extension.fileTypes && !extension.fileTypes.includes(target.fileType)) errors.push(`「${extension.name}」不适用于当前文件类型。`);
      if (extension.baseVersionRanges && (target.baseReleaseId === null || !isInVersionRanges(getBaseRelease(target.baseReleaseId).order,
        extension.baseVersionRanges, baseId => getBaseRelease(baseId).order))) errors.push(`「${extension.name}」需要兼容的基准版本。`);
      for (const dependency of extension.requiredPackageIds ?? []) {
        const required = getExtensionPackage(dependency);
        if (!target.packageIds.includes(dependency)) errors.push(`「${extension.name}」需要安装「${required.name}」。`);
      }
    }
  } catch (reason) { errors.push(reason instanceof Error ? reason.message : String(reason)); }
  return errors;
}

export function assertWorkspaceTarget(target: WorkspaceTarget): void {
  const errors = workspaceTargetErrors(target);
  if (errors.length) throw new Error(errors.join("；"));
}
