/** Follow actual media progress; a virtual clock is only used for blocked audio. */
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
  const virtualPosition = () => elapsed + (running ? (performance.now() - startedAt) / 1000 : 0);
  const audioMaster = () => audio && !failed.has(audio) && !blockedAudio && !audio.ended ? audio : null;
  const master = () => audioMaster() ?? tracks().filter((element) => element !== audio && !element.ended)
    .sort((a, b) => b.duration - a.duration)[0];
  const position = () => master()?.currentTime ?? virtualPosition();
  const correctedAt = new Map<HTMLMediaElement, number>();

  function pause() {
    elapsed = virtualPosition();
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
    if (available.every((element) => element.ended ||
      (element === audio && blockedAudio && Number.isFinite(element.duration) && virtualPosition() >= element.duration))) {
      pause();
      elapsed = 0;
      correctedAt.clear();
      available.forEach((element) => { if (element.readyState >= 1) element.currentTime = 0; });
      start();
      return;
    }
    for (const element of available) {
      // Short tracks keep their final frame/silence until the longest track ends.
      if (element === audio || element === master() || element.ended || element.seeking || element.readyState < 2) continue;
      const target = Math.min(time, element.duration);
      if (Number.isFinite(target) && Math.abs(element.currentTime - target) > 0.35 &&
        performance.now() - (correctedAt.get(element) ?? -Infinity) >= 1000) {
        correctedAt.set(element, performance.now());
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
      if (element !== audio && element !== master() && Number.isFinite(target) && Math.abs(element.currentTime - target) > 0.35) element.currentTime = target;
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
      // Video decoding/seeking must not repeatedly interrupt the audio track.
      if (running && !audioMaster() && element !== audio && !element.ended && element.readyState < 2) pause();
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
      correctedAt.clear();
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
      const wasBlocked = blockedAudio;
      const joinTime = position();
      audio.muted = !value;
      if (value) {
        blockedAudio = false;
        onAudioBlocked(false);
        if (active && running && !audio.ended && audio.readyState >= 2) {
          if (audio.paused) {
            if (wasBlocked) audio.currentTime = Math.min(joinTime, audio.duration);
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
