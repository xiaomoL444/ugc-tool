/** Persisted IDs are stable; never renumber or reuse them. */
export enum WorkspaceFileType {
  BeyondMap = 0,
  BeyondComponent = 1,
  ClassicComponent = 2,
}

export const workspaceFileTypeOptions = [
  { value: WorkspaceFileType.BeyondMap, label: "超限模式地图版" },
  { value: WorkspaceFileType.BeyondComponent, label: "超限模式元件版" },
  { value: WorkspaceFileType.ClassicComponent, label: "经典模式元件版" },
] as const;

export function isWorkspaceFileType(value: unknown): value is WorkspaceFileType {
  return workspaceFileTypeOptions.some(option => option.value === value);
}

export interface VersionRange {
  min?: { releaseId: number; inclusive: boolean };
  max?: { releaseId: number; inclusive: boolean };
}

export interface ReleaseVersions {
  gameVersion: string;
  templateVersion: string;
  internalVersion: string;
}

export function formatReleaseLabel(release: ReleaseVersions): string {
  return `原神v${release.gameVersion}，模版版本v${release.templateVersion}，模版内部版本v${release.internalVersion}`;
}

export interface BaseRelease extends ReleaseVersions {
  id: number;
  order: number;
  /** Always enabled with this baseline; users cannot deselect these packages. */
  packageIds: readonly number[];
  fileTypes?: readonly WorkspaceFileType[];
}

/** Each package is one fixed collection of content; it has no separate version catalogue. */
export interface ExtensionPackage {
  id: number;
  name: string;
  fileTypes?: readonly WorkspaceFileType[];
  baseVersionRanges?: readonly VersionRange[];
  requiredPackageIds?: readonly number[];
}

export interface WorkspaceTarget {
  fileType: WorkspaceFileType;
  /** Legacy inputs may contain null; workspace settings resolve it to the legacy baseline. */
  baseReleaseId: number | null;
  packageIds: readonly number[];
}
