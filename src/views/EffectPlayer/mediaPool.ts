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
  function lease(entry: Entry) {
    idleEntries.delete(entry);
    let released = false;
    return {
      value: entry.value,
      release() {
        if (released) return;
        released = true;
        idleEntries.add(entry);
        trim();
      },
    };
  }
  function tryAcquireCached(key: string) {
    for (const entry of idleEntries) {
      if (entry.key === key) return lease(entry);
    }
    return null;
  }
  return {
    tryAcquireCached,
    acquire(key: string, create: () => T) {
      return tryAcquireCached(key) ?? lease({ key, value: create() });
    },
  };
}
