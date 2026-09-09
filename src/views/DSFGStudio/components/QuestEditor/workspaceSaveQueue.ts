/** Debounced persistence of already-captured file paths and serialized snapshots. */
export function createWorkspaceSaveQueue(
  write: (path: string, data: string) => Promise<void>,
  onError: (error: unknown) => void,
  delay = 500,
) {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  async function drain() {
    while (pending.size > 0) {
      const [path, data] = pending.entries().next().value as [string, string];
      pending.delete(path);
      try {
        await write(path, data);
      } catch (error) {
        // A change made during this write always wins over its failed snapshot.
        if (!pending.has(path)) pending.set(path, data);
        try {
          onError(error);
        } catch {
          // Error reporting must not hide the actual persistence error.
        }
        throw error;
      }
    }
  }

  async function flush(): Promise<void> {
    clearTimer();
    while (running !== undefined || pending.size > 0) {
      if (running === undefined) {
        // Assign the shared promise before invoking potentially synchronous writers.
        running = Promise.resolve().then(drain).finally(() => {
          running = undefined;
        });
      }
      await running;
      clearTimer();
    }
  }

  function schedule(path: string, data: string) {
    pending.set(path, data);
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      // drain reports failures and retains the latest snapshot for a later retry.
      void flush().catch(() => undefined);
    }, delay);
  }

  /** Only pending snapshots are discarded; an in-flight write is not cancelled. */
  function discard(path?: string) {
    if (path === undefined) pending.clear();
    else pending.delete(path);
    if (pending.size === 0) clearTimer();
  }

  return { schedule, flush, discard };
}
