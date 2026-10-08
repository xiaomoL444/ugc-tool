<template>
  <div ref="previewRef" class="bgm-mini-preview" :class="{ 'is-open': expanded }">
    <div class="bgm-preview-row">
      <span class="bgm-preview-icon">
        <img v-if="albumCoverUrl && inViewport && !coverFailed" :src="albumCoverUrl" :alt="album || title" loading="lazy" @error="coverFailed = true" />
        <SearchIcon v-else name="music" />
      </span>
      <div v-if="album || formattedDuration" class="bgm-preview-meta">
        <span v-if="album" class="bgm-preview-album" :title="album">{{ album }}</span>
        <span v-if="formattedDuration" class="bgm-preview-duration">{{ formattedDuration }}</span>
      </div>
      <button v-if="validSongId" type="button" class="bgm-preview-toggle" :aria-expanded="expanded" @click="togglePreview">
        <SearchIcon :name="expanded ? 'close' : 'music'" />
        {{ t(expanded ? 'aiSearch.preview.closeBgm' : 'aiSearch.preview.listenBgm') }}
      </button>
      <span v-else class="bgm-preview-unavailable">{{ t('aiSearch.preview.bgmUnavailable') }}</span>
    </div>
    <div v-if="expanded && validSongId" class="bgm-player-wrap">
      <iframe
        ref="playerFrame"
        :src="playerUrl"
        :title="t('aiSearch.preview.bgmPlayerLabel', { name: title })"
        frameborder="0"
        marginwidth="0"
        marginheight="0"
        allow="autoplay"
      ></iframe>
      <a :href="songUrl" class="bgm-external-link" target="_blank" rel="noopener noreferrer">
        {{ t('aiSearch.preview.bgmExternal') }}<SearchIcon name="external" />
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { createOss } from "@/utils/oss";
import { claimPreviewPlayback, registerPreviewStop } from "../previewPlayback";
import SearchIcon from "./SearchIcon.vue";

const props = defineProps<{ songId?: number; title: string; album?: string; albumId?: number; duration?: number }>();
const { t } = useI18n({ useScope: "global" });
const oss = createOss("BgmPlayer");
const previewRef = ref<HTMLElement | null>(null);
const playerFrame = ref<HTMLIFrameElement | null>(null);
const expanded = ref(false);
const inViewport = ref(false);
const coverFailed = ref(false);
const validSongId = computed(() => Number.isSafeInteger(props.songId) && Number(props.songId) > 0 ? props.songId : undefined);
const albumCoverUrl = computed(() => Number.isSafeInteger(props.albumId) && Number(props.albumId) > 0
  ? oss.path("album_pic", `${props.albumId}.jpg`)
  : undefined);
const playerUrl = computed(() => `https://music.163.com/outchain/player?type=2&id=${validSongId.value}&auto=0&height=66`);
const songUrl = computed(() => `https://music.163.com/song?id=${validSongId.value}`);
const formattedDuration = computed(() => {
  if (!Number.isFinite(props.duration) || Number(props.duration) <= 0) return "";
  const seconds = Math.round(Number(props.duration));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});
let observer: IntersectionObserver | undefined;
let unregister: (() => void) | undefined;

function stopPreview() {
  // The cross-origin player exposes no pause API. Removing its frame stops
  // playback and prevents hidden history cards from keeping music alive.
  // Navigate synchronously as the next preview can start in the same event.
  if (playerFrame.value) playerFrame.value.src = "about:blank";
  expanded.value = false;
}

function togglePreview() {
  if (expanded.value) {
    stopPreview();
    return;
  }
  if (!validSongId.value) return;
  claimPreviewPlayback(stopPreview);
  expanded.value = true;
}

function visibilityChanged() {
  if (document.hidden) stopPreview();
}

watch(() => props.songId, stopPreview);
watch(() => props.albumId, () => { coverFailed.value = false; });

onMounted(() => {
  unregister = registerPreviewStop(stopPreview);
  if (typeof IntersectionObserver === "undefined") inViewport.value = true;
  else {
    observer = new IntersectionObserver(([entry]) => {
      inViewport.value = Boolean(entry?.isIntersecting);
      if (!inViewport.value) stopPreview();
    });
    if (previewRef.value) observer.observe(previewRef.value);
  }
  document.addEventListener("visibilitychange", visibilityChanged);
});

onDeactivated(stopPreview);

onBeforeUnmount(() => {
  stopPreview();
  unregister?.();
  observer?.disconnect();
  document.removeEventListener("visibilitychange", visibilityChanged);
});
</script>

<style scoped>
.bgm-mini-preview { overflow: hidden; border: 1px solid #e7e5f1; border-radius: 10px; background: #f9f8fd; }
.bgm-preview-row { display: flex; align-items: center; gap: 9px; min-height: 43px; padding: 8px 10px; box-sizing: border-box; }
.bgm-preview-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; color: #8b69bc; }
.bgm-preview-icon svg { width: 20px; height: 20px; }
.bgm-preview-icon img { width: 32px; height: 32px; border-radius: 5px; object-fit: cover; }
.bgm-preview-meta { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 3px; color: #81808f; font-size: 11px; }
.bgm-preview-album { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bgm-preview-duration { font-variant-numeric: tabular-nums; }
.bgm-preview-toggle { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; margin-left: auto; border: 1px solid #ddd7eb; border-radius: 7px; padding: 6px 8px; background: #fff; color: #786096; font: inherit; font-size: 11px; cursor: pointer; }
.bgm-preview-toggle:hover { border-color: #bdafd4; background: #f3eefb; }
.bgm-preview-toggle:focus-visible, .bgm-external-link:focus-visible { outline: 2px solid #8273ed; outline-offset: 3px; }
.bgm-preview-toggle svg { width: 12px; height: 12px; }
.bgm-preview-unavailable { color: #9995a7; font-size: 11px; }
.bgm-player-wrap { padding: 0 5px 8px; border-top: 1px solid #ebe7f3; }
.bgm-player-wrap iframe { display: block; width: 100%; height: 86px; border: 0; }
.bgm-external-link { display: inline-flex; align-items: center; gap: 5px; margin: 0 5px; color: #8b779f; font-size: 10px; text-decoration: none; }
.bgm-external-link:hover { color: #6253ce; }
.bgm-external-link svg { width: 11px; height: 11px; }
</style>
