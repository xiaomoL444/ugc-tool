/** One shared clock controls all tracks, including audio blocked by autoplay policy. */
export function createSynchronizedMedia(
  media: HTMLMediaElement[],
  audio: HTMLMediaElement | null,
  onAudioBlocked: (blocked: boolean) => void = () => undefined,
) {
  let active = false;
  let running = false;
  let disposed = false;
  let frame = 0;
  let generation = 0;
  let elapsed = 0;
  let startedAt = 0;
  let blockedAudio = false;
  let recovery: ReturnType<typeof setInterval> | undefined;
  const pending = new Set<HTMLMediaElement>();
  const failed = new Set<HTMLMediaElement>();
  const cleanups: (() => void)[] = [];
  const tracks = () => media.filter((element) => !failed.has(element));
  const position = () => elapsed + (running ? (performance.now() - startedAt) / 1000 : 0);

  function pause() {
    elapsed = position();
    running = false;
    generation += 1;
    cancelAnimationFrame(frame);
    media.forEach((element) => element.pause());
  }

  function blockAudio() {
    if (!audio) return;
    blockedAudio = true;
    audio.muted = true;
    onAudioBlocked(true);
  }

  function play(element: HTMLMediaElement) {
    if (pending.has(element)) return;
    pending.add(element);
    const token = generation;
    void element.play().then(() => {
      if (disposed || !active || !running) element.pause();
    }).catch((error: DOMException) => {
      if (disposed || token !== generation || error.name === "AbortError") return;
      if (element === audio && error.name === "NotAllowedError") {
        // Keep its duration in the loop even when the browser blocks muted audio.
        blockAudio();
      } else if (element.error || error.name === "NotSupportedError") {
        failed.add(element);
        element.pause();
      } else {
        pause();
      }
    }).finally(() => pending.delete(element));
  }

  function start() {
    if (!active || disposed || running) return;
    const available = tracks();
    const videos = available.filter((element) => element !== audio);
    const required = videos.length ? videos : available;
    if (!available.length || required.some((element) =>
      element.seeking || (!element.ended && element.readyState < 2),
    )) return;
    running = true;
    startedAt = performance.now();
    available.forEach((element) => {
      if (!element.ended && element.readyState >= 2 && !(element === audio && blockedAudio)) play(element);
    });
    frame = requestAnimationFrame(tick);
  }

  function tick() {
    if (!running || disposed) return;
    const available = tracks();
    if (!available.length) { pause(); return; }
    const time = position();
    const duration = Math.max(...available.map((element) => Number.isNaN(element.duration) ? 0 : element.duration));
    if ((Number.isFinite(duration) && time >= duration) || available.every((element) => element.ended)) {
      pause();
      elapsed = 0;
      available.forEach((element) => { if (element.readyState >= 1) element.currentTime = 0; });
      start();
      return;
    }
    for (const element of available) {
      // Short tracks keep their final frame/silence until the longest track ends.
      if (element.ended || element.seeking || element.readyState < 2 || (element === audio && blockedAudio)) continue;
      const target = Math.min(time, element.duration);
      if (Number.isFinite(target) && Math.abs(element.currentTime - target) > 0.2) {
        element.currentTime = target;
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function recover() {
    if (!active || disposed) return;
    start();
    if (!running) return;
    for (const element of tracks()) {
      if (!element.paused || element.ended || element.seeking || element.readyState < 2 || (element === audio && blockedAudio)) continue;
      const target = Math.min(position(), element.duration);
      if (Number.isFinite(target) && Math.abs(element.currentTime - target) > 0.1) element.currentTime = target;
      play(element);
    }
  }

  for (const element of media) {
    element.loop = false;
    element.muted = true;
    const listen = (event: string, handler: () => void) => {
      element.addEventListener(event, handler);
      cleanups.push(() => element.removeEventListener(event, handler));
    };
    listen("canplay", recover);
    listen("loadeddata", recover);
    listen("seeked", recover);
    listen("waiting", () => {
      if (running && element !== audio && !element.ended && element.readyState < 2) pause();
    });
    listen("error", () => { failed.add(element); element.pause(); start(); });
    // Some browsers pause autoplaying audio when it becomes audible.
    listen("pause", () => {
      if (element === audio && active && running && element.paused && !pending.has(element) && !failed.has(element) && !element.ended && !element.muted) {
        blockAudio();
      }
    });
  }

  return {
    restart() {
      if (disposed) return;
      pause();
      elapsed = 0;
      tracks().forEach((element) => {
        if (element.readyState >= 1) element.currentTime = 0;
      });
      recover();
    },
    retryFailed() {
      const retry = [...failed];
      failed.clear();
      retry.forEach((element) => element.load());
    },
    setActive(value: boolean) {
      active = value;
      if (value) {
        if (recovery === undefined) recovery = setInterval(recover, 250);
        recover();
      } else {
        clearInterval(recovery);
        recovery = undefined;
        pause();
      }
    },
    setAudible(value: boolean) {
      if (!audio || failed.has(audio) || disposed) return;
      audio.muted = !value;
      if (value) {
        blockedAudio = false;
        onAudioBlocked(false);
        if (active && running && !audio.ended && audio.readyState >= 2) {
          if (audio.paused) {
            audio.currentTime = Math.min(position(), audio.duration);
            play(audio);
          }
        }
      }
    },
    dispose() {
      disposed = true;
      active = false;
      clearInterval(recovery);
      pause();
      cleanups.forEach((cleanup) => cleanup());
      media.forEach((element) => { element.removeAttribute("src"); element.load(); });
    },
  };
}
