import { onBeforeUnmount, onMounted, type Ref } from "vue";
import type { DialogueProject } from "./types/FileStruct";
import { DIALOGUE_NODE_GRID_SIZE } from "./useDnD";
import { copyDialogueGraphNodes, parseDialogueGraphClipboard, type DialogueGraphClipboard } from "./utils/dialogueGraphClipboard";

export interface DialogueGraphClipboardOptions {
  project: Ref<DialogueProject | undefined>;
  element: Ref<HTMLElement | undefined>;
  enabled: () => boolean;
  selectedNodeIds: () => string[];
  paste: (clipboard: DialogueGraphClipboard, offset: number) => boolean;
  onCopy: (count: number) => void;
  onError: (error: unknown) => void;
}

/** Native copy/paste events provide clipboard access without permission prompts. */
export function useDialogueGraphClipboard(options: DialogueGraphClipboardOptions) {
  let disposed = false;
  let lastText = "";
  let pasteCount = 0;
  function owns(event: ClipboardEvent) {
    const target = event.target as Element | null;
    const root = options.element.value;
    if (disposed || !options.enabled() || !options.project.value || !root || root.closest("[inert]")
      || !target || target.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return false;
    return root.contains(target) || target === document.body || target === document.documentElement;
  }
  function copy(event: ClipboardEvent) {
    if (!owns(event) || !event.clipboardData || event.defaultPrevented) return;
    try {
      const clipboard = copyDialogueGraphNodes(options.project.value!, options.selectedNodeIds());
      if (!clipboard) return;
      const text = JSON.stringify(clipboard);
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      event.stopPropagation();
      lastText = text;
      pasteCount = 0;
      options.onCopy(clipboard.nodes.length);
    } catch (error) { options.onError(error); }
  }
  function paste(event: ClipboardEvent) {
    if (!owns(event) || !event.clipboardData || event.defaultPrevented) return;
    try {
      const text = event.clipboardData.getData("text/plain");
      const clipboard = parseDialogueGraphClipboard(text);
      if (!clipboard) return;
      event.preventDefault();
      event.stopPropagation();
      const count = text === lastText ? pasteCount + 1 : 1;
      if (options.paste(clipboard, count * DIALOGUE_NODE_GRID_SIZE * 3)) {
        lastText = text;
        pasteCount = count;
      }
    } catch (error) {
      event.preventDefault();
      options.onError(error);
    }
  }
  onMounted(() => {
    window.addEventListener("copy", copy, true);
    window.addEventListener("paste", paste, true);
  });
  onBeforeUnmount(() => {
    disposed = true;
    window.removeEventListener("copy", copy, true);
    window.removeEventListener("paste", paste, true);
  });
}
