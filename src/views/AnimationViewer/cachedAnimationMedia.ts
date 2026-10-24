import { reactive } from 'vue';
import { createOss } from '@/utils/oss';
import { createMediaPool } from '../EffectPlayer/mediaPool';

const oss = createOss('AnimationViewer');

/** Owns its listeners and playback state independently of a virtual card. */
function createAnimationMedia(path: string) {
  const element = document.createElement('video');
  element.muted = true;
  element.defaultMuted = true;
  element.loop = true;
  element.playsInline = true;
  element.preload = 'auto';
  element.setAttribute('disablepictureinpicture', '');
  element.setAttribute('disableremoteplayback', '');
  element.src = oss.path(path);
  const state = reactive({ ready: false, failed: false, autoplayBlocked: false });
  let active = false;
  let disposed = false;
  let playRequest = 0;

  async function play() {
    if (!active || disposed || state.failed) return;
    const request = ++playRequest;
    element.muted = true;
    element.defaultMuted = true;
    try {
      await element.play();
      if (disposed || !active) element.pause();
      else if (request === playRequest) state.autoplayBlocked = false;
    } catch (error) {
      if (disposed || !active || request !== playRequest) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') state.autoplayBlocked = true;
      // pause(), retry(), and virtual unmounts can abort an outstanding play.
    }
  }
  function canPlay() { state.ready = true; void play(); }
  function playing() {
    state.ready = true;
    state.autoplayBlocked = false;
    if (!active) element.pause();
  }
  function failed() { state.failed = true; state.ready = false; }
  const listeners = { canplay: canPlay, playing, error: failed };
  Object.entries(listeners).forEach(([event, listener]) => element.addEventListener(event, listener));

  function setActive(value: boolean) {
    active = value;
    element.autoplay = value;
    if (value) void play();
    else { playRequest += 1; element.pause(); }
  }
  return {
    element,
    state,
    setActive,
    configure(title: string) {
      element.setAttribute('aria-label', title);
    },
    retry() {
      state.failed = false;
      state.ready = false;
      state.autoplayBlocked = false;
      playRequest += 1;
      element.load();
      void play();
    },
    park() {
      setActive(false);
      element.remove();
    },
    dispose() {
      disposed = true;
      setActive(false);
      Object.entries(listeners).forEach(([event, listener]) => element.removeEventListener(event, listener));
      element.remove();
      element.removeAttribute('src');
      element.load();
    },
  };
}

export type CachedAnimationMedia = ReturnType<typeof createAnimationMedia>;

// Match EffectPlayer's bounded cache: unmounted cards keep paused, detached
// videos for nearby revisits; evicting the oldest idle lease releases its source.
const pool = createMediaPool<CachedAnimationMedia>(64);
function animationMediaKey(path: string, variant: string, cacheKey: string) {
  return JSON.stringify([variant, cacheKey, path]);
}
export function acquireAnimationMedia(path: string, variant: string, cacheKey = '') {
  return pool.acquire(animationMediaKey(path, variant, cacheKey), () => createAnimationMedia(path));
}
export function tryAcquireCachedAnimationMedia(path: string, variant: string, cacheKey = '') {
  return pool.tryAcquireCached(animationMediaKey(path, variant, cacheKey));
}
