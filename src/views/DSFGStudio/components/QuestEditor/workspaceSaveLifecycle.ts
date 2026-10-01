import type { createWorkspaceSaveQueue } from "./workspaceSaveQueue";

type SaveQueue = Pick<ReturnType<typeof createWorkspaceSaveQueue>, "flush" | "hasPendingChanges">;

/** Browser navigation does not wait for Vue's asynchronous unmount save. */
export function bindWorkspaceSaveLifecycle(
  queue: SaveQueue,
  target: Window = window,
  page: Document = document,
) {
  function flushPending() {
    // The queue reports errors and retains the latest snapshot for retry.
    if (queue.hasPendingChanges()) void queue.flush().catch(() => undefined);
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!queue.hasPendingChanges()) return;
    flushPending();
    // Async writes may be cancelled on navigation; never treat starting a
    // flush as successful persistence. Warn until it actually completes.
    event.preventDefault();
    event.returnValue = "";
  }

  function visibilityChange() {
    if (page.visibilityState === "hidden") flushPending();
  }

  target.addEventListener("beforeunload", beforeUnload);
  page.addEventListener("visibilitychange", visibilityChange);
  return () => {
    target.removeEventListener("beforeunload", beforeUnload);
    page.removeEventListener("visibilitychange", visibilityChange);
  };
}
