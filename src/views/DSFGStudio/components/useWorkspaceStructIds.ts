import { inject, type InjectionKey, type Ref } from "vue";
import { moduleStructIds, validateWorkspaceStructIds, type WorkspaceStructIds } from "./workspaceStructIds";
import type { DialogueProject } from "./DialogueEditor/types/FileStruct";
import type { QuestProject } from "./QuestEditor/types";
import type { WalkTalkProject } from "./WalkTalkEditor/walkTalkProject";
import type { SceneProject } from "./SceneEditor/sceneProject";
import { createDefaultQxqyStructIds } from "./DialogueEditor/utils/qxqyStructWorkspace";
import { useWorkspaceSettings } from "./useWorkspaceSettings";

export const workspaceStructIdsKey: InjectionKey<{ ids: Ref<WorkspaceStructIds>; error: Ref<string> }> = Symbol("workspaceStructIds");
export function useWorkspaceStructIds() {
  const context = inject(workspaceStructIdsKey, undefined);
  const target = useWorkspaceSettings();
  function settings() {
    if (!context) return undefined; // Standalone consumers keep their explicit IDs.
    const errors = validateWorkspaceStructIds(context.ids.value, target.value);
    if (context.error.value || errors.length) throw new Error(`请点击工作区右侧的三点按钮，在「工作区设置」中设置结构体 ID。${context.error.value || errors.join("；")}`);
    return moduleStructIds(context.ids.value);
  }
  return {
    camera: () => settings()?.dialogue ?? createDefaultQxqyStructIds(),
    dialogue: (project: DialogueProject): DialogueProject => {
      const ids = settings()?.dialogue;
      return ids ? { ...project, exportSettings: { ...project.exportSettings, qxqyStructIds: ids } } : project;
    },
    quest: (project: QuestProject): QuestProject => ({ ...project, structIds: settings()?.quest ?? project.structIds }),
    walkTalk: (project: WalkTalkProject): WalkTalkProject => ({ ...project, structIds: settings()?.walkTalk ?? project.structIds }),
    scene: (project: SceneProject): SceneProject => ({ ...project, structIds: settings()?.scene ?? project.structIds }),
  };
}
