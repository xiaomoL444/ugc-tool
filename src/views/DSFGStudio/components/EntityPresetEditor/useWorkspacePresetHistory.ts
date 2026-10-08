import { computed, provide, shallowReactive, watch, type InjectionKey, type Ref } from "vue";
import { useStudioHistory } from "../useStudioHistory";

interface WorkspacePresetHistoryContext {
  register<T extends { id: string }>(fileName: string, presets: Ref<T[]>, ready: Ref<boolean>): void;
}
export const workspacePresetHistoryKey: InjectionKey<WorkspacePresetHistoryContext> = Symbol("workspacePresetHistory");

/** Each category keeps its own history; late loads cannot erase another category's edits. */
export function useWorkspacePresetHistory(options: {
  element: Ref<HTMLElement | undefined>;
  activeFile: () => string;
  activateFile?: (fileName: string) => void;
  onError: (error: unknown) => void;
}) {
  const histories = shallowReactive(new Map<string, ReturnType<typeof useStudioHistory>>());
  const context: WorkspacePresetHistoryContext = {
    register(fileName, presets, ready) {
      if (histories.has(fileName)) return;
      const history = useStudioHistory({
        element: options.element,
        blocked: () => !ready.value,
        active: () => options.activeFile() === fileName,
        activate: () => options.activateFile?.(fileName),
        capture: () => JSON.stringify(presets.value),
        restore: snapshot => { presets.value = JSON.parse(snapshot); },
        label: "修改预设",
        onError: options.onError,
      });
      watch(ready, () => history.reset(), { flush: "sync" });
      histories.set(fileName, history);
    },
  };
  provide(workspacePresetHistoryKey, context);
  return {
    register: context.register,
    current: computed(() => histories.get(options.activeFile())),
    finish: () => histories.forEach(history => history.finish()),
  };
}
