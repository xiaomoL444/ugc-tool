/** Retain paused media across virtual-list unmounts without keeping every effect forever. */
export function createMediaPool<T extends { dispose(): void }>(maxIdle = 64) {
  const entries = new Map<string, { value: T; users: number }>();
  function trim() {
    const idle = [...entries].filter(([, entry]) => entry.users === 0);
    for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - maxIdle))) {
      entries.delete(key);
      entry.value.dispose();
    }
  }
  return {
    acquire(key: string, create: () => T) {
      const entry = entries.get(key) ?? { value: create(), users: 0 };
      entries.delete(key);
      entries.set(key, entry);
      entry.users += 1;
      let released = false;
      return {
        value: entry.value,
        release() {
          if (released) return;
          released = true;
          entry.users -= 1;
          trim();
        },
      };
    },
  };
}
