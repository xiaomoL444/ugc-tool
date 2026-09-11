<template>
  <div
    ref="wrapRef"
    class="effect-media"
    :class="[`is-${variant}`, { 'has-tail': Boolean(item.tailPath) }]"
    @pointerdown="enableAudio"
  >
    <div class="video-panes" :class="{ 'is-loading': !mediaReady }" :aria-hidden="!mediaReady">
      <div v-if="item.standPath" class="video-pane">
        <div ref="standHost" class="media-host" />
        <span v-if="standFailed" class="media-error">主特效视频加载失败</span>
      </div>
      <img v-else class="fallback-icon" :src="iconUrl" :alt="title" />
      <div v-if="item.tailPath" class="video-pane tail-pane">
        <div ref="tailHost" class="media-host" />
        <span v-if="tailFailed" class="media-error">拖尾视频加载失败</span>
      </div>
    </div>
    <div v-if="!mediaReady" class="loading-state">
      <img class="loading-icon" :src="iconUrl" :alt="title" />
      <span v-if="loadError" class="media-error" role="status">{{ loadError }}</span>
    </div>
    <div ref="audioHost" hidden />
    <img v-if="mediaReady && (item.standPath || item.tailPath)" class="preview-icon" :src="iconUrl" :alt="title" />
    <span v-if="mediaReady && item.hasAudio && item.audioPath" class="audio-status">
      {{ audioFailed ? '音频加载失败' : audioBlocked ? (variant === 'modal' ? '声音未开启' : '点击预览以开启声音') : audible ? '声音开启' : '悬停播放声音' }}
    </span>
    <button v-if="mediaReady && variant === 'modal' && audioBlocked" class="enable-audio" type="button" @click.stop="enableAudio">
      开启声音
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { createOss } from "@/utils/oss";
import { acquireEffectMedia } from "./cachedEffectMedia";
import type { EffectItem } from "./types/EffectData";

const props = withDefaults(defineProps<{
  item: EffectItem;
  variant?: "card" | "modal";
  suspended?: boolean;
}>(), { variant: "card", suspended: false });
const oss = createOss("EffectPlayer");
const wrapRef = ref<HTMLElement | null>(null);
const standHost = ref<HTMLElement | null>(null);
const tailHost = ref<HTMLElement | null>(null);
const audioHost = ref<HTMLElement | null>(null);
const hovered = ref(false);
const visible = ref(props.variant === "modal");
const pageVisible = ref(true);
const lease = shallowRef<ReturnType<typeof acquireEffectMedia> | null>(null);
const audioBlocked = computed(() => lease.value?.value.state.audioBlocked ?? false);
const standFailed = computed(() => lease.value?.value.state.standFailed ?? false);
const tailFailed = computed(() => lease.value?.value.state.tailFailed ?? false);
const audioFailed = computed(() => lease.value?.value.state.audioFailed ?? false);
const mediaReady = computed(() => lease.value?.value.state.ready ?? false);
const loadError = computed(() => [
  standFailed.value && '主特效视频加载失败',
  tailFailed.value && '拖尾视频加载失败',
  audioFailed.value && '音频加载失败',
].filter(Boolean).join('、'));
const title = computed(() => props.item.title || props.item.name || props.item.id);
const iconUrl = computed(() => oss.path("icon", props.item.icon || `${props.item.id}.png`));
const active = computed(() => visible.value && pageVisible.value && !props.suspended);
const audible = computed(() => active.value && (props.variant === "modal" || hovered.value));
let observer: IntersectionObserver | undefined;
let hoverTarget: HTMLElement | null = null;
let destroyed = false;
let setupVersion = 0;

function updatePlayback() {
  if (active.value && !lease.value) setupMedia();
  lease.value?.value.controller.setActive(active.value && mediaReady.value);
  lease.value?.value.controller.setAudible(audible.value);
}

function setupMedia() {
  lease.value = acquireEffectMedia(props.item, props.variant);
  const { stand, tail, audio } = lease.value.value;
  if (stand && standHost.value) standHost.value.appendChild(stand);
  if (tail && tailHost.value) tailHost.value.appendChild(tail);
  if (audio && audioHost.value) audioHost.value.appendChild(audio);
}

function releaseMedia() {
  lease.value?.value.park();
  lease.value?.release();
  lease.value = null;
}
function setHover(value: boolean) {
  hovered.value = value;
  // Run directly inside the event, rather than delaying audio activation to a Vue watcher.
  if (active.value) lease.value?.value.controller.setAudible(props.variant === "modal" || value);
}
function enterCard() {
  if (props.variant === "card" && active.value) {
    lease.value?.value.controller.restart();
  }
  setHover(true);
}
function leaveCard() { setHover(false); }
function enableAudio() {
  if (active.value && (hovered.value || props.variant === "modal")) lease.value?.value.controller.setAudible(true);
}
function visibilityChanged() { pageVisible.value = !document.hidden; }
watch([active, audible, mediaReady], updatePlayback);
watch(() => [props.item.id, props.item.standPath, props.item.tailPath, props.item.hasAudio, props.item.audioPath], async () => {
  const version = ++setupVersion;
  releaseMedia();
  await nextTick();
  if (!destroyed && version === setupVersion) updatePlayback();
});
onMounted(() => {
  hoverTarget = props.variant === "card"
    ? wrapRef.value?.closest<HTMLElement>("[data-effect-card]") ?? wrapRef.value
    : wrapRef.value;
  hoverTarget?.addEventListener("mouseenter", enterCard);
  hoverTarget?.addEventListener("mouseleave", leaveCard);
  visibilityChanged();
  document.addEventListener("visibilitychange", visibilityChanged);
  document.addEventListener("pointerdown", enableAudio);
  document.addEventListener("keydown", enableAudio);
  observer = new IntersectionObserver(([entry]) => {
    hovered.value = Boolean(hoverTarget?.matches(":hover"));
    visible.value = entry.isIntersecting;
  });
  if (wrapRef.value) observer.observe(wrapRef.value);
  updatePlayback();
});
onBeforeUnmount(() => {
  destroyed = true;
  observer?.disconnect();
  hoverTarget?.removeEventListener("mouseenter", enterCard);
  hoverTarget?.removeEventListener("mouseleave", leaveCard);
  document.removeEventListener("visibilitychange", visibilityChanged);
  document.removeEventListener("pointerdown", enableAudio);
  document.removeEventListener("keydown", enableAudio);
  releaseMedia();
});
</script>

<style scoped>
.effect-media { position: relative; overflow: hidden; background: #111218; width: 100%; flex-shrink: 0; }
.effect-media.is-card { height: 160px; }
.effect-media.is-modal { width: min(900px, 88vw); height: min(55vh, 520px); }
.video-panes { display: flex; width: 100%; height: 100%; align-items: stretch; justify-content: center; }
.video-panes.is-loading { visibility: hidden; }
.loading-state { position: absolute; inset: 0; }
.loading-icon { display: block; width: 100%; height: 100%; object-fit: contain; }
.preview-icon { position: absolute; right: 8px; bottom: 8px; z-index: 2; width: 48px; height: 48px; padding: 4px; object-fit: contain; background: rgba(17, 18, 24, 0.82); border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); pointer-events: none; }
.is-modal .preview-icon { right: 12px; bottom: 12px; width: 96px; height: 96px; padding: 6px; border-color: rgba(159, 231, 255, 0.35); border-radius: 12px; }
.video-pane { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; }
.tail-pane { border-left: 1px solid rgba(210, 226, 255, 0.65); }
.media-host, .media-host :deep(video), .fallback-icon { display: block; width: 100%; height: 100%; object-fit: contain; min-width: 0; }
.has-tail .fallback-icon { width: 50%; }
.audio-status { position: absolute; left: 6px; bottom: 6px; padding: 3px 6px; border-radius: 5px; background: #111b; color: #d7eef8; font-size: 0.65rem; pointer-events: none; }
.media-error { position: absolute; left: 0; right: 0; bottom: 30px; text-align: center; color: #c0c7d4; font-size: 0.75rem; }
.enable-audio { position: absolute; bottom: 12px; right: 132px; border: 1px solid #73bfff; border-radius: 8px; padding: 8px 14px; color: white; background: #2366ab; font: inherit; cursor: pointer; }
@media (max-width: 600px) { .effect-media.is-modal { height: min(44vh, 360px); } }
</style>
