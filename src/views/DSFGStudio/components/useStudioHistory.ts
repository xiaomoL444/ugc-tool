import { computed, getCurrentInstance, inject, nextTick, onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { createEditorHistory } from "../../ClientUIAnimationEditor/editorHistory";
import { studioSidebarKey } from "./studioSidebar";
import { studioEditorActiveKey, studioSessionHistoryKey } from "./studioSessionHistory";

export interface StudioHistoryOptions {
  capture: () => string;
  restore: (snapshot: string) => void;
  element: Ref<HTMLElement | undefined>;
  blocked: () => boolean;
  active?: () => boolean;
  activate?: () => void;
  session?: boolean;
  ownsTarget?: (target: Element) => boolean;
  label: string;
  onError: (error: unknown) => void;
}

const textInputSelector = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='button']):not([type='submit']), textarea, [contenteditable]:not([contenteditable='false'])";
let studioHistorySequence = 0;

/** Shared gestures and shortcuts; snapshots contain only the editor's saved data. */
export function useStudioHistory(options: StudioHistoryOptions) {
  const sidebar = getCurrentInstance() ? inject(studioSidebarKey, undefined) : undefined;
  const editorActive = getCurrentInstance() ? inject(studioEditorActiveKey, () => true) : () => true;
  const session = options.session !== false && getCurrentInstance() ? inject(studioSessionHistoryKey, undefined) : undefined;
  const owner = `studio-history-${++studioHistorySequence}`;
  const history = createEditorHistory({
    capture: options.capture, restore: options.restore, describe: () => options.label, limit: 100,
    onCommit: entry => session?.recordEdit(owner, entry, {
      undo: () => replayLocal("undo"), redo: () => replayLocal("redo"),
    }),
    onReset: () => session?.resetOwner(owner),
  });
  let pointerId: number | undefined;
  let inputTarget: EventTarget | null = null;
  let disposed = false;
  let epoch = 0;
  const allowed = () => !disposed && editorActive() && !options.blocked() && !history.busy.value && !session?.busy.value;
  const active = () => allowed() && (options.active?.() ?? true) && !options.element.value?.closest?.("[inert]");
  function owns(event: Event) {
    const target = event.target as Element | null;
    return !!target && !target.closest?.("[inert]") && (options.element.value?.contains(target)
      || sidebar?.value?.contains(target) || options.ownsTarget?.(target)
      || !!target.closest?.("[data-clip-editor], .studio-select-menu"));
  }
  watch(options.capture, snapshot => {
    if (allowed()) history.observe(snapshot);
  }, { flush: "sync" });
  // File loads reset before unblocking; failed loads retain the current history.
  watch(options.blocked, blocked => {
    if (!blocked && allowed()) history.observe(options.capture());
  }, { flush: "sync" });
  if (options.active) watch(options.active, enabled => { if (!enabled) finish(); }, { flush: "sync" });
  watch(editorActive, enabled => { if (!enabled) finish(); }, { flush: "sync" });
  const unregister = session?.registerFinisher(owner, () => { if (!options.blocked()) finish(); },
    () => editorActive() && (options.active?.() ?? true), () => history.hasPending.value);

  function beginPointer(event: PointerEvent) {
    if (!active() || !owns(event) || event.button !== 0
      || (event.target as Element | null)?.closest?.("[data-dialogue-history-tools], [data-studio-history-tools]")) return;
    if (inputTarget && inputTarget !== event.target) {
      inputTarget = null;
      history.end("input");
    }
    pointerId = event.pointerId;
    history.begin("pointer");
  }
  function endPointer(event: PointerEvent) {
    if (pointerId !== event.pointerId) return;
    const current = pointerId;
    queueMicrotask(() => {
      if (current !== pointerId || disposed) return;
      pointerId = undefined;
      history.end("pointer");
    });
  }
  function beginInput(event: Event) {
    const target = event.target as Element | null;
    if (!active() || !owns(event) || !target?.matches?.(textInputSelector)) return;
    if (inputTarget && inputTarget !== target) history.end("input");
    inputTarget = target;
    history.begin("input");
  }
  function endInput(event: FocusEvent) {
    if (event.target !== inputTarget) return;
    const current = inputTarget;
    queueMicrotask(() => {
      if (current !== inputTarget || disposed) return;
      inputTarget = null;
      history.end("input");
    });
  }
  function finish() {
    pointerId = undefined;
    inputTarget = null;
    history.end("input");
    history.end("pointer");
    history.end("drop");
    history.flush();
  }
  function reset() {
    epoch++;
    pointerId = undefined;
    inputTarget = null;
    history.reset(options.capture());
  }
  async function run(action: "undo" | "redo") {
    if (!active() || pointerId !== undefined) return;
    finish();
    try { await (session ?? history)[action](); }
    catch (error) { options.onError(error); }
  }
  async function replayLocal(action: "undo" | "redo") {
    if (disposed || options.blocked()) throw new Error("当前编辑内容正在读写，请稍后撤销或重做。");
    options.activate?.();
    await nextTick();
    await history[action]();
  }
  function shortcut(event: KeyboardEvent) {
    if (session) return;
    const key = event.key.toLowerCase();
    if (event.defaultPrevented || event.isComposing || (!event.ctrlKey && !event.metaKey) || event.altKey
      || !active() || (!owns(event) && event.target !== document.body && event.target !== document.documentElement)
      || !["z", "y"].includes(key)) return;
    // The toolbar restores complete operations; text fields keep native text undo.
    if ((event.target as Element | null)?.closest?.(textInputSelector)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void run(key === "y" || event.shiftKey ? "redo" : "undo");
  }
  function beginDrop(event: DragEvent) {
    if (!active() || !owns(event)) return;
    history.begin("drop");
    const current = epoch;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!disposed && current === epoch) history.end("drop"); }));
  }
  onMounted(() => {
    window.addEventListener("pointerdown", beginPointer, true);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    window.addEventListener("focusin", beginInput, true);
    window.addEventListener("input", beginInput, true);
    window.addEventListener("focusout", endInput, true);
    window.addEventListener("drop", beginDrop, true);
    window.addEventListener("keydown", shortcut, true);
    window.addEventListener("blur", finish);
  });
  onBeforeUnmount(() => {
    disposed = true;
    epoch++;
    history.dispose();
    unregister?.();
    window.removeEventListener("pointerdown", beginPointer, true);
    window.removeEventListener("pointerup", endPointer);
    window.removeEventListener("pointercancel", endPointer);
    window.removeEventListener("focusin", beginInput, true);
    window.removeEventListener("input", beginInput, true);
    window.removeEventListener("focusout", endInput, true);
    window.removeEventListener("drop", beginDrop, true);
    window.removeEventListener("keydown", shortcut, true);
    window.removeEventListener("blur", finish);
  });
  return { ...history, finish, reset,
    canUndo: session?.canUndo ?? history.canUndo,
    canRedo: session?.canRedo ?? history.canRedo,
    busy: computed(() => history.busy.value || !!session?.busy.value),
    undo: () => run("undo"), redo: () => run("redo"),
  };
}

/** Restore exact drafts without running file migrations or export validation. */
export function useStudioDocumentHistory<T>(options: {
  project: Ref<T | undefined>;
  element: Ref<HTMLElement | undefined>;
  blocked: () => boolean;
  label: string;
  afterRestore?: () => void;
  ownsTarget?: (target: Element) => boolean;
  onError: (error: unknown) => void;
}) {
  const history = useStudioHistory({
    ...options,
    blocked: () => !options.project.value || options.blocked(),
    capture: () => options.project.value ? JSON.stringify(options.project.value) : "",
    restore: snapshot => {
      options.project.value = JSON.parse(snapshot) as T;
      options.afterRestore?.();
    },
  });
  // Replacement during load/import/delete starts a new document. Undo replaces
  // data with editing enabled and must keep its commands.
  watch(options.project, () => { if (options.blocked()) history.reset(); }, { flush: "sync" });
  return history;
}
