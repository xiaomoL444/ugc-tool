import type { Ref } from "vue";

export function normalizeStudioFileName(input: string) {
  const base = input.trim().replace(/\.json$/i, "");
  if (!base || /[<>:"/\\|?*\u0000-\u001f]/.test(base) || base === "." || base === "..") return "";
  return `${base}.json`;
}

export function createStudioFileRename(options: {
  files: Ref<string[]>;
  selectedFile: Ref<string>;
  busy: Ref<boolean>;
  disposed: () => boolean;
  move: (source: string, destination: string) => Promise<void>;
  flush: () => Promise<void>;
  scheduleSave: () => void;
  finishHistory?: () => void;
}) {
  let activeMove: { dirty: boolean } | undefined;

  // Background edits wait until the active file's path is settled.
  function deferSave() {
    if (!activeMove) return false;
    activeMove.dirty = true;
    return true;
  }

  async function renameFile(source: string, input: string) {
    const { files, selectedFile, busy, disposed } = options;
    if (busy.value || disposed()) return;
    const destination = normalizeStudioFileName(input);
    if (!destination) throw new Error("请输入有效的文件名");
    if (source === destination) return;

    const isSelected = source === selectedFile.value;
    busy.value = true;
    try {
      if (isSelected) {
        options.finishHistory?.();
        activeMove = { dirty: false };
        await options.flush();
      }
      if (disposed()) return;
      await options.move(source, destination);
      if (disposed()) return;
      if (isSelected) selectedFile.value = destination;
      files.value = files.value.map(file => file === source ? destination : file);
      return destination;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "EEXIST" || code === "already_exists") throw new Error("已有同名文件");
      throw error;
    } finally {
      const needsSave = activeMove?.dirty;
      activeMove = undefined;
      busy.value = false;
      if (needsSave) options.scheduleSave();
    }
  }

  return { renameFile, deferSave };
}
