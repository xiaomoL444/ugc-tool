import type { ExtensionPackage } from "./types";

/** Fixed extension package IDs are stable; configure content applicability separately. */
export const extensionPackages: readonly ExtensionPackage[] = [
  // 暂不随本次发布开放；开放时同时恢复 baseReleases.ts 中的基准 ID 2。
  // { id: 1, name: "7.2技能动画扩展包" },
];
