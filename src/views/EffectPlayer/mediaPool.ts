/** Retain paused media across virtual-list unmounts without keeping every effect forever. */
export function createMediaPool<T extends { dispose(): void }>(maxIdle = 64) {
  type Entry = { key: string; value: T };
  // A live lease owns its media exclusively. Release order gives idle media a
  // global LRU order, including separate instances of the same resource.
  const idleEntries = new Set<Entry>();
  function trim() {
    while (idleEntries.size > Math.max(0, maxIdle)) {
      const entry = idleEntries.values().next().value!;
      idleEntries.delete(entry);
      entry.value.dispose();
    }
  }
  return {
    acquire(key: string, create: () => T) {
      let entry: Entry | undefined;
      for (const candidate of idleEntries) {
        if (candidate.key === key) { entry = candidate; break; }
      }
      entry ??= { key, value: create() };
      idleEntries.delete(entry);
      const leasedEntry = entry;
      let released = false;
      return {
        value: leasedEntry.value,
        release() {
          if (released) return;
          released = true;
          idleEntries.add(leasedEntry);
          trim();
        },
      };
    },
  };
}
