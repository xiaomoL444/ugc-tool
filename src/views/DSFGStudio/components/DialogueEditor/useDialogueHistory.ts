import type { Ref } from "vue";
import { useStudioHistory } from "../useStudioHistory";
import type { DialogueProject } from "./types/FileStruct";
import { toSerializableDialogueProject } from "./utils/dialogueProjectCodec";

export interface DialogueHistoryOptions {
  project: Ref<DialogueProject | undefined>;
  element: Ref<HTMLElement | undefined>;
  blocked: () => boolean;
  afterRestore: () => void;
  onError: (error: unknown) => void;
}

/** One document history across text, graph and Timeline, excluding Vue Flow UI state. */
export function useDialogueHistory(options: DialogueHistoryOptions) {
  return useStudioHistory({
    ...options,
    blocked: () => !options.project.value || options.blocked(),
    capture: () => options.project.value ? JSON.stringify(toSerializableDialogueProject(options.project.value)) : "",
    restore(snapshot) {
      if (!snapshot) throw new Error("没有可恢复的对话内容。");
      options.project.value = JSON.parse(snapshot) as DialogueProject;
      options.afterRestore();
    },
    label: "修改对话",
  });
}
