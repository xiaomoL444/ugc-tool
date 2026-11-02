import { inject, readonly, ref, type InjectionKey, type Ref } from "vue";
import { createWorkspaceSettings, type WorkspaceSettings } from "./workspaceSettings";

export const workspaceSettingsKey: InjectionKey<Readonly<Ref<WorkspaceSettings>>> = Symbol("workspaceSettings");
const legacySettings = readonly(ref(createWorkspaceSettings()));

/** Shared reactive target from the studio shell; standalone tools retain legacy defaults. */
export function useWorkspaceSettings(): Readonly<Ref<WorkspaceSettings>> {
  return inject(workspaceSettingsKey, undefined) ?? legacySettings;
}

