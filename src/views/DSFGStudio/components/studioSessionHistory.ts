import { computed, ref, shallowRef, type InjectionKey } from "vue";
import type { EditorHistoryEntry } from "../../ClientUIAnimationEditor/editorHistory";
import type { StudioEditorKind } from "./studioSidebar";

export interface StudioSessionHistoryOptions {
  currentEditor: () => StudioEditorKind;
  /** Save the current editor before changing the selected module. */
  switchEditor: (kind: StudioEditorKind) => Promise<void>;
  blocked: () => boolean;
  finishActive?: () => void;
  limit?: number;
}

export interface StudioSessionHistoryEntry extends EditorHistoryEntry {
  owner?: string;
}

interface SessionCommand extends StudioSessionHistoryEntry {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const editorLabels: Record<StudioEditorKind, string> = {
  Dialogue: "对话", Quest: "任务", WalkTalk: "边走边说", EntityPresets: "预设", Scene: "场景", Camera: "镜头",
};

/** One chronological journal for retained editors and successful module switches. */
export function createStudioSessionHistory(options: StudioSessionHistoryOptions) {
  const entries = shallowRef<StudioSessionHistoryEntry[]>([]);
  const index = ref(-1);
  const busy = ref(false);
  const finishers = new Map<string, { finish: () => void; active: () => boolean; hasPending?: () => boolean }>();
  const finisherRevision = ref(0);
  const limit = Number.isFinite(options.limit) && (options.limit ?? 0) > 0
    ? Math.max(1, Math.floor(options.limit!)) : 100;
  let commands: SessionCommand[] = [];
  let switchSequence = 0;
  let revision = 0;
  let disposed = false;

  const activePending = computed(() => {
    finisherRevision.value;
    return [...finishers.values()].some(registration => registration.active() && registration.hasPending?.());
  });
  const canUndo = computed(() => !disposed && !busy.value && !options.blocked() && (index.value >= 0 || activePending.value));
  const canRedo = computed(() => !disposed && !busy.value && !options.blocked() && !activePending.value && index.value < entries.value.length - 1);

  function syncEntries() {
    entries.value = commands.map(({ id, label, owner }) => ({ id, label, owner }));
  }

  function add(command: SessionCommand) {
    if (disposed || busy.value) return;
    commands = [...commands.slice(0, index.value + 1), command].slice(-limit);
    index.value = commands.length - 1;
    syncEntries();
  }

  function recordEdit(owner: string, entry: EditorHistoryEntry, history: { undo: () => Promise<void>; redo: () => Promise<void> }) {
    // A command is registered once on its local commit, never during replay.
    if (commands.some(command => command.owner === owner && command.id === entry.id)) return;
    add({ ...entry, owner, undo: () => history.undo(), redo: () => history.redo() });
  }

  function recordSwitch(before: StudioEditorKind, after: StudioEditorKind) {
    if (before === after) return;
    const switchTo = async (kind: StudioEditorKind) => {
      if (options.currentEditor() !== kind) await options.switchEditor(kind);
    };
    add({
      id: `studio-switch-${++switchSequence}`, label: `切换到${editorLabels[after]}`,
      undo: () => switchTo(before), redo: () => switchTo(after),
    });
  }

  function registerFinisher(owner: string, finish: () => void, active: () => boolean, hasPending?: () => boolean) {
    const registration = { finish, active, hasPending };
    finishers.set(owner, registration);
    finisherRevision.value++;
    return () => {
      if (finishers.get(owner) !== registration) return;
      finishers.delete(owner);
      finisherRevision.value++;
    };
  }

  function finishRegistered() {
    if (disposed || busy.value) return;
    options.finishActive?.();
    for (const registration of [...finishers.values()]) {
      if (registration.active()) registration.finish();
    }
  }

  function resetOwner(owner: string) {
    if (disposed) return;
    const removedBeforeCursor = commands.slice(0, index.value + 1).filter(command => command.owner === owner).length;
    commands = commands.filter(command => command.owner !== owner);
    index.value -= removedBeforeCursor;
    syncEntries();
  }

  function clear() {
    if (disposed) return;
    revision++;
    commands = [];
    index.value = -1;
    syncEntries();
  }

  async function run(action: "undo" | "redo") {
    if (disposed || busy.value) return;
    // Finishing a text edit may add the command that this undo should restore.
    finishRegistered();
    if (options.blocked() || (action === "undo" ? index.value < 0 : index.value >= commands.length - 1)) return;
    const cursor = index.value;
    const command = commands[action === "undo" ? cursor : cursor + 1];
    const currentRevision = revision;
    busy.value = true;
    try {
      await command[action]();
      // A file load may remove other commands while a navigation save awaits.
      // Locate the same command after filtering; workspace clear invalidates all.
      const commandIndex = commands.indexOf(command);
      if (!disposed && currentRevision === revision && commandIndex >= 0) {
        index.value = commandIndex + (action === "undo" ? -1 : 0);
      }
    } finally {
      busy.value = false;
    }
  }

  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
    finishers.clear();
    finisherRevision.value++;
  }

  return {
    entries, index, busy, canUndo, canRedo,
    recordEdit, recordSwitch, registerFinisher, finishRegistered, resetOwner, clear,
    undo: () => run("undo"), redo: () => run("redo"), dispose,
  };
}

export type StudioSessionHistory = ReturnType<typeof createStudioSessionHistory>;
export const studioSessionHistoryKey: InjectionKey<StudioSessionHistory> = Symbol("studioSessionHistory");
export const studioEditorActiveKey: InjectionKey<() => boolean> = Symbol("studioEditorActive");
