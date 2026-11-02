import type { BaseRelease } from "./types";

/** Existing complete templates are the initial baselines; extension contents are configured separately. */
export const baseReleases: readonly BaseRelease[] = [
  {
    id: 1,
    order: 1,
    gameVersion: "7.1",
    templateVersion: "2.0",
    internalVersion: "1.0.3",
    packageIds: [],
  },
  // 暂不随本次发布开放 7.2；开放时同时恢复 extensionPackages.ts 中的扩展包 ID 1。
  // {
  //   id: 2,
  //   order: 2,
  //   gameVersion: "7.2",
  //   templateVersion: "2.1",
  //   internalVersion: "1.0.4",
  //   packageIds: [1],
  // },
];

/** Existing workspaces without settings stay on the original 2.0 baseline. */
export const legacyBaseReleaseId = 1;
/** Only newly created workspaces follow the latest baseline. */
export const latestBaseReleaseId = baseReleases.reduce((latest, item) => item.order > latest.order ? item : latest).id;
