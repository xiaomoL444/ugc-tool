import { reactive } from "vue";
import { createOss } from "@/utils/oss";
import { createMediaPool } from "./mediaPool";
import { createSynchronizedMedia } from "./synchronizedMedia";
import type { EffectItem } from "./types/EffectData";

const oss = createOss("EffectPlayer");
function createMedia(item: EffectItem) {
  const state = reactive({ ready: false, audioBlocked: false, standFailed: false, tailFailed: false, audioFailed: false });
  function video(path: string | undefined) {
    if (!path) return null;
    const element = document.createElement("video");
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.preload = "auto";
    element.src = oss.path("webm", path);
    return element;
  }
  const stand = video(item.standPath);
  const tail = video(item.tailPath);
  const audio = item.hasAudio && item.audioPath ? document.createElement("audio") : null;
  if (stand) {
    stand.onerror = () => { state.standFailed = true; };
  }
  if (tail) tail.onerror = () => { state.tailFailed = true; };
  if (audio) {
    audio.muted = true;
    audio.preload = "auto";
    audio.src = oss.path("audio", item.audioPath!);
    audio.onerror = () => { state.audioFailed = true; };
  }
  const elements = [stand, tail, audio].filter((element): element is HTMLMediaElement => Boolean(element));
  // Keep the group hidden until every configured track can play. Once loaded,
  // seeking/looping should not flash the loading placeholder again.
  const loaded = new Set<HTMLMediaElement>();
  function updateReady() {
    elements.forEach((element) => {
      if (element.error) loaded.delete(element);
      else if (element.readyState >= 3) loaded.add(element);
    });
    state.ready = elements.every((element) => loaded.has(element));
  }
  const readinessEvents = ["canplay", "canplaythrough", "loadeddata", "error", "emptied"];
  function resetReady(event: Event) {
    if (event.type === "emptied") loaded.delete(event.target as HTMLMediaElement);
    updateReady();
  }
  elements.forEach((element) => readinessEvents.forEach((event) => element.addEventListener(event, resetReady)));
  updateReady();
  const controller = createSynchronizedMedia(elements, audio, (value) => { state.audioBlocked = value; });
  return {
    stand, tail, audio, state, controller,
    park() {
      controller.setAudible(false);
      controller.setActive(false);
      elements.forEach((element) => element.remove());
    },
    dispose() {
      elements.forEach((element) => readinessEvents.forEach((event) => element.removeEventListener(event, resetReady)));
      controller.dispose();
      elements.forEach((element) => element.remove());
    },
  };
}
const pool = createMediaPool<ReturnType<typeof createMedia>>();
export function acquireEffectMedia(item: EffectItem, variant: string) {
  const key = JSON.stringify([variant, item.id, item.standPath, item.tailPath, item.hasAudio, item.audioPath]);
  const lease = pool.acquire(key, () => createMedia(item));
  const { state, controller } = lease.value;
  if (state.standFailed || state.tailFailed || state.audioFailed) {
    state.standFailed = state.tailFailed = state.audioFailed = false;
    controller.retryFailed();
  }
  return lease;
}
