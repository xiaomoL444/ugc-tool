import { computed, ref, shallowRef } from "vue";
import UndoManager from "../../lib/undo-manager/undo-manager";

export interface EditorHistoryEntry {
  id: string;
  label: string;
}

export interface EditorHistoryOptions {
  capture: () => string;
  restore: (snapshot: string) => void;
  describe: (before: string, after: string) => string;
  limit?: number;
}

interface PendingChange {
  before: string;
  after: string;
}

interface ReplayContext {
  manager: UndoManager;
  revision: number;
  suppressRestore: boolean;
  failed: boolean;
  error?: unknown;
}

let historyId = 0;

/** Snapshot commands grouped by complete user gestures, backed by the shared undo library. */
export function createEditorHistory(options: EditorHistoryOptions) {
  const entries = shallowRef<EditorHistoryEntry[]>([]);
  const index = ref(-1);
  const busy = ref(false);
  const pending = shallowRef<PendingChange | null>(null);
  const sources = new Set<string>();
  const instanceId = ++historyId;
  const limit = Number.isFinite(options.limit) && (options.limit ?? 0) > 0
    ? Math.max(1, Math.floor(options.limit!))
    : 100;
  let sequence = 0;
  let baseline = options.capture();
  let revision = 0;
  let disposed = false;
  let flushToken = 0;
  let flushQueued = false;
  let replay: ReplayContext | null = null;
  let manager = makeManager();

  const canUndo = computed(() => !disposed && !busy.value && (pending.value !== null || index.value >= 0));
  const canRedo = computed(() => !disposed && !busy.value && pending.value === null && index.value < entries.value.length - 1);

  function makeManager() {
    const next = new UndoManager();
    next.setLimit(limit);
    next.setCallback(() => {
      if (!disposed && next === manager) syncEntries();
    });
    return next;
  }

  function syncEntries() {
    entries.value = manager.getCommands().map((command) => ({
      id: command.groupId!,
      label: command.label ?? "修改编辑文件",
    }));
    index.value = manager.getIndex();
  }

  function invalidateScheduledFlush() {
    flushToken += 1;
    flushQueued = false;
  }

  function updatePending(snapshot: string) {
    pending.value = snapshot === baseline ? null : { before: baseline, after: snapshot };
  }

  function observe(snapshot: string) {
    if (disposed || busy.value) return;
    updatePending(snapshot);
    if (sources.size || flushQueued || !pending.value) return;
    flushQueued = true;
    const token = ++flushToken;
    const observedRevision = revision;
    queueMicrotask(() => {
      if (disposed || token !== flushToken || observedRevision !== revision) return;
      flushQueued = false;
      if (!sources.size) flush();
    });
  }

  function restoreCommand(snapshot: string, owner: UndoManager, commandRevision: number) {
    const context = replay;
    if (disposed || owner !== manager || commandRevision !== revision || !context
      || context.manager !== owner || context.revision !== revision || context.suppressRestore) return;
    // The shared library does not clear its execution flag when a command rejects.
    // Capture failures here, then repair its cursor and report the error in run().
    try {
      options.restore(snapshot);
    } catch (error) {
      context.failed = true;
      context.error = error;
    }
  }

  function flush() {
    if (disposed || busy.value) return;
    invalidateScheduledFlush();
    // Capture here too: a pointer-up/undo may precede Vue's scheduled observer.
    updatePending(options.capture());
    const change = pending.value;
    if (!change) return;
    const label = options.describe(change.before, change.after);
    const id = `editor-history-${instanceId}-${++sequence}`;
    const owner = manager;
    const commandRevision = revision;
    pending.value = null;
    baseline = change.after;
    owner.add({
      groupId: id,
      label,
      undo: () => restoreCommand(change.before, owner, commandRevision),
      redo: () => restoreCommand(change.after, owner, commandRevision),
    });
  }

  function begin(source: string) {
    if (disposed || busy.value || sources.has(source)) return;
    if (!sources.size) flush();
    sources.add(source);
  }

  function end(source: string) {
    if (disposed || busy.value || !sources.delete(source)) return;
    if (!sources.size) flush();
  }

  function reset(snapshot?: string) {
    if (disposed) return;
    const nextBaseline = snapshot === undefined ? options.capture() : snapshot;
    revision += 1;
    invalidateScheduledFlush();
    sources.clear();
    pending.value = null;
    baseline = nextBaseline;
    replay = null;
    manager = makeManager();
    busy.value = false;
    syncEntries();
  }

  async function run(action: "undo" | "redo") {
    if (disposed || busy.value) return;
    flush();
    sources.clear();
    if (action === "undo" ? !manager.hasUndo() : !manager.hasRedo()) return;
    const originalSnapshot = options.capture();
    const context: ReplayContext = {
      manager,
      revision,
      suppressRestore: false,
      failed: false,
    };
    const isCurrent = () => !disposed && manager === context.manager && revision === context.revision;
    replay = context;
    busy.value = true;
    try {
      // The local declaration predates the library's async implementation; await
      // its result so the toolbar cannot race the cursor update after restore().
      await context.manager[action]();
      if (!isCurrent()) return;
      if (context.failed) {
        context.suppressRestore = true;
        await context.manager[action === "undo" ? "redo" : "undo"]();
        if (!isCurrent()) return;
        try {
          options.restore(originalSnapshot);
        } catch (rollbackError) {
          // An application restore that also fails to roll back cannot safely
          // retain commands against an unknown document state.
          reset(options.capture());
          throw new Error(`恢复操作失败，回滚也失败：${String(context.error)}；${String(rollbackError)}`);
        }
        baseline = originalSnapshot;
        throw context.error;
      }
      baseline = options.capture();
      pending.value = null;
    } finally {
      if (isCurrent()) {
        replay = null;
        busy.value = false;
        syncEntries();
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    revision += 1;
    invalidateScheduledFlush();
    sources.clear();
    pending.value = null;
    replay = null;
    entries.value = [];
    index.value = -1;
    busy.value = false;
    manager.clear();
  }

  return {
    entries,
    index,
    busy,
    canUndo,
    canRedo,
    begin,
    end,
    observe,
    flush,
    reset,
    undo: () => run("undo"),
    redo: () => run("redo"),
    dispose,
  };
}
