<template>
  <video ref="video" class="vfx-source" :data-vfx-id="asset.id" muted playsinline preload="auto" @error="failed = true" @ended="finish" @play="syncAudio(true)" @pause="syncAudio(false)" @seeked="syncAudio()" />
  <canvas ref="transmission" v-show="enabled && ready && !finished && !failed" class="vfx-pass vfx-transmission" :class="{ 'vfx-cover': cover }" :style="placement" aria-hidden="true" />
  <canvas ref="emission" v-show="enabled && ready && !finished && !failed" class="vfx-pass vfx-emission" :class="{ 'vfx-cover': cover }" :style="placement" aria-hidden="true" />
  <div v-if="enabled && (failed || blocked)" class="vfx-playback-message" :style="placement" role="status"><button @pointerdown.stop @click.stop="restart">{{ t(failed ? 'clientUIAnimationEditor.ui.vfx.retryPlayback' : 'clientUIAnimationEditor.ui.vfx.play') }}</button></div>
</template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import { t } from "../../i18n";
import type { UIVfxAsset } from "./uiVfxAssets";
import { attachUIVfxRenderer } from "./uiVfxRenderer";
const props = withDefaults(defineProps<{ asset: UIVfxAsset; enabled?: boolean; sound?: boolean; restartToken?: number | string; placement?: CSSProperties; cover?: boolean }>(), { enabled: true, sound: false, restartToken: 0, cover: false });
const video = ref<HTMLVideoElement | null>(null), transmission = ref<HTMLCanvasElement | null>(null), emission = ref<HTMLCanvasElement | null>(null);
const ready = ref(false), finished = ref(false), failed = ref(false), blocked = ref(false);
let renderer: ReturnType<typeof attachUIVfxRenderer> | null = null;
let audio: HTMLAudioElement | null = null, epoch = 0, disposed = false;
let loadedAssetId: number | null = null;
const playedScreenSounds = new Set<number>();
function chooseAudio() {
  if (!audio || !props.asset.audioUrls.length) return;
  // audioUrls are alternative takes, so only one may play per effect trigger.
  const url = props.asset.audioUrls[Math.floor(Math.random() * props.asset.audioUrls.length)];
  audio.pause(); audio.src = url;
  try { audio.currentTime = 0; } catch { /* Metadata may still be loading. */ }
}
function syncAudio(play = Boolean(video.value && !video.value.paused && !video.value.ended)) {
  const source = video.value;
  if (!source || loadedAssetId !== props.asset.id) return;
  if (props.asset.scope === 'screen') {
    const showing = play && props.enabled && !document.hidden;
    const firstShow = showing && !playedScreenSounds.has(props.asset.id);
    // Consume the first showing even with sound disabled. Video loops, seeks,
    // later show/activate triggers and replay buttons must never start it again.
    if (showing) playedScreenSounds.add(props.asset.id);
    if (audio) {
      audio.muted = !props.sound;
      audio.loop = false;
      if (!showing || !props.sound) audio.pause();
      else if (firstShow) {
        chooseAudio();
        void audio.play().catch(() => { /* Browser may require a user gesture for sound. */ });
      }
    }
    return;
  }
  if (audio) {
    audio.muted = !props.sound;
    audio.loop = props.asset.isLoop;
    if (Math.abs(audio.currentTime - source.currentTime) > .15) {
      try { audio.currentTime = source.currentTime; } catch { /* Metadata may still be loading. */ }
    }
    if (play && props.enabled && props.sound && !document.hidden) void audio.play().catch(() => { /* Browser may require a user gesture for sound. */ });
    else audio.pause();
  }
}
function releaseAudio() {
  if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio = null; }
  loadedAssetId = null;
}
function finish() {
  if (props.asset.isLoop) {
    const duration = video.value?.duration ?? 0;
    playFrom(Number.isFinite(duration) && duration > 0 ? duration / 2 : 0);
  } else { finished.value = true; syncAudio(false); }
}
function pause() { ++epoch; video.value?.pause(); syncAudio(false); }
function restart() { playFrom(0, true); }
function playFrom(time: number, reset = false) {
  const source = video.value;
  if (!source || disposed || !props.enabled || document.hidden) return;
  const current = ++epoch;
  finished.value = false; failed.value = false; blocked.value = false;
  if (reset) ready.value = false;
  if (source.error) source.load();
  if (reset && props.asset.scope === 'ui') chooseAudio();
  source.currentTime = time;
  void source.play().then(() => {
    if (current !== epoch || disposed || !props.enabled) return;
    renderer?.draw(); syncAudio(true);
  }).catch(error => {
    if (current !== epoch || disposed || error?.name === "AbortError") return;
    blocked.value = error?.name === "NotAllowedError";
    failed.value = !blocked.value;
  });
}
function load() {
  const source = video.value;
  if (!source) return;
  pause(); releaseAudio(); ready.value = false; finished.value = false; failed.value = false;
  // Native looping wraps to zero. Handle ended ourselves so only the latter
  // half repeats, keeping the first half as the effect's opening sequence.
  source.crossOrigin = "anonymous"; source.muted = true; source.loop = false;
  if (props.asset.audioUrls.length) { audio = new Audio(); audio.preload = "auto"; }
  loadedAssetId = props.asset.id;
  source.src = props.asset.url; source.load(); restart();
}
function visibility() {
  if (document.hidden) pause();
  else if (props.enabled && !finished.value) {
    void video.value?.play().catch(() => { blocked.value = true; });
  }
}
onMounted(() => {
  try {
    renderer = attachUIVfxRenderer(video.value!, transmission.value!, emission.value!, {
      onFrame: () => { ready.value = true; }, onError: () => { failed.value = true; pause(); },
    });
    load(); document.addEventListener("visibilitychange", visibility);
  } catch { failed.value = true; }
});
watch(() => props.asset, load);
watch(() => props.enabled, enabled => { if (enabled) restart(); else { pause(); ready.value = false; } });
watch(() => props.restartToken, restart);
watch(() => props.sound, () => syncAudio());
onBeforeUnmount(() => { disposed = true; pause(); renderer?.destroy(); releaseAudio(); document.removeEventListener("visibilitychange", visibility); video.value?.removeAttribute("src"); video.value?.load(); });
</script>
<style scoped>
.vfx-source { display: none; }
.vfx-pass { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; object-fit: fill; }
.vfx-transmission { mix-blend-mode: multiply; }
.vfx-emission { mix-blend-mode: plus-lighter; }
.vfx-cover { object-fit: cover; }
.vfx-playback-message { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.vfx-playback-message button { pointer-events: auto; max-width: 100%; padding: 6px 10px; background: #272d3e; color: #e1e7f4; border: 1px solid #6277ad; border-radius: 5px; cursor: pointer; }
</style>
