<template>
  <div ref="previewElement" class="sound-mini-preview">
    <AudioWaveform :src="audioSource" :current-time="currentTime" :duration="duration"
      :disabled="!metadataReady || !isVisible" @seek="seek" />
    <div class="sound-mini-controls">
      <button type="button" class="sound-mini-play" :disabled="!audioSource"
        :aria-label="`${t(playing || playPending ? 'soundEffectPlayer.ui.pause' : 'soundEffectPlayer.ui.play')} ${title}`"
        :title="t(playing || playPending ? 'soundEffectPlayer.ui.pause' : 'soundEffectPlayer.ui.play')"
        @click="togglePlay">
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <template v-if="playing || playPending"><rect x="5" y="4" width="3.5" height="12" rx="1" /><rect x="11.5" y="4" width="3.5" height="12" rx="1" /></template>
          <path v-else d="M6 3.8a.8.8 0 0 1 1.2-.7l9.1 6.2a.8.8 0 0 1 0 1.4l-9.1 6.2A.8.8 0 0 1 6 16.2Z" />
        </svg>
      </button>
      <span v-if="loading || playPending || buffering" class="sound-mini-loading" role="status">{{ t('soundEffectPlayer.ui.loading') }}</span>
      <span class="sound-mini-time">{{ formatTime(currentTime) }} <span>/ {{ formatTime(duration) }}</span></span>
    </div>
    <p v-if="playbackError" class="sound-mini-error" role="status">{{ t('soundEffectPlayer.ui.playFailed') }}</p>
    <audio ref="audioElement" :src="audioSource || undefined" :preload="isVisible ? 'metadata' : 'none'" hidden
      @loadedmetadata="loadMetadata" @durationchange="updateDuration" @timeupdate="updateTime"
      @play="onPlay" @playing="buffering = false" @pause="onPause" @ended="onPause"
      @waiting="buffering = true" @error="onAudioError" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AudioWaveform from '../../SoundEffectPlayer/AudioWaveform.vue'
import { claimPreviewPlayback, registerPreviewStop } from '../previewPlayback'

const props = defineProps<{ src: string; title: string; duration?: number }>()
const { t } = useI18n()
const previewElement = ref<HTMLElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)
const inViewport = ref(false)
const active = ref(true)
const pageVisible = ref(true)
const isVisible = computed(() => inViewport.value && active.value && pageVisible.value)
const audioSource = computed(() => isVisible.value ? props.src : '')
const currentTime = ref(0)
const mediaDuration = ref(0)
const duration = computed(() => mediaDuration.value || validDuration(props.duration))
const metadataReady = ref(false)
const loading = ref(false)
const playing = ref(false)
const playPending = ref(false)
const buffering = ref(false)
const playbackError = ref(false)
let observer: IntersectionObserver | undefined
let unregisterPlayback: (() => void) | undefined
let playRequest = 0
let animationFrame: number | null = null

function validDuration(seconds: number | undefined): number {
  return seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

function stopPlayback() {
  playRequest += 1
  stopProgressAnimation()
  audioElement.value?.pause()
  updateTime()
  playing.value = false
  playPending.value = false
  buffering.value = false
}

watch(audioSource, async (src, _previous, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  stopPlayback()
  currentTime.value = 0
  mediaDuration.value = 0
  metadataReady.value = false
  playbackError.value = false
  loading.value = Boolean(src)
  await nextTick()
  if (!cancelled) audioElement.value?.load()
})

async function togglePlay() {
  if (playing.value || playPending.value) {
    stopPlayback()
    return
  }
  const audio = audioElement.value
  if (!audio || !audioSource.value) return
  if (playbackError.value) {
    metadataReady.value = false
    loading.value = true
    audio.load()
  }
  playbackError.value = false
  claimPreviewPlayback(stopPlayback)
  const request = ++playRequest
  playPending.value = true
  try {
    await audio.play()
    if (request !== playRequest) return
    playPending.value = false
    if (!isVisible.value) stopPlayback()
  } catch {
    if (request !== playRequest) return
    stopProgressAnimation()
    playPending.value = false
    buffering.value = false
    loading.value = false
    playing.value = false
    playbackError.value = true
  }
}

function onPlay() {
  if (!isVisible.value) {
    stopPlayback()
    return
  }
  // A queued play event can arrive after another card has already paused us.
  if (audioElement.value?.paused !== false) return
  claimPreviewPlayback(stopPlayback)
  playing.value = true
  startProgressAnimation()
}

function onPause() {
  // Ignore an older pause event if the user has since started a new play request.
  if (audioElement.value && !audioElement.value.paused && !audioElement.value.ended) return
  playing.value = false
  buffering.value = false
  stopProgressAnimation()
  updateTime()
}

function stopProgressAnimation() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame)
  animationFrame = null
}

function startProgressAnimation() {
  stopProgressAnimation()
  // Match the full sound player: sample the real playback position each frame.
  // Native timeupdate events alone are too infrequent for a smooth cursor.
  const tick = () => {
    animationFrame = null
    const audio = audioElement.value
    if (!audio || !isVisible.value || audio.paused || audio.ended) return
    updateTime()
    animationFrame = requestAnimationFrame(tick)
  }
  animationFrame = requestAnimationFrame(tick)
}

function loadMetadata() {
  if (!audioSource.value) return
  updateDuration()
  metadataReady.value = true
  loading.value = false
}

function updateDuration() {
  mediaDuration.value = validDuration(audioElement.value?.duration)
}

function updateTime() {
  currentTime.value = Math.max(0, audioElement.value?.currentTime || 0)
}

function seek(seconds: number) {
  const audio = audioElement.value
  if (!audio || !metadataReady.value || !isVisible.value) return
  audio.currentTime = Math.max(0, Math.min(seconds, duration.value))
  updateTime()
}

function onAudioError() {
  if (!audioSource.value) return
  stopPlayback()
  loading.value = false
  metadataReady.value = false
  playbackError.value = true
}

function onPageVisibilityChange() {
  pageVisible.value = document.visibilityState !== 'hidden'
  if (!pageVisible.value) stopPlayback()
}

onMounted(() => {
  unregisterPlayback = registerPreviewStop(stopPlayback)
  onPageVisibilityChange()
  document.addEventListener('visibilitychange', onPageVisibilityChange)
  if (typeof IntersectionObserver === 'undefined') {
    inViewport.value = true
    return
  }
  observer = new IntersectionObserver(([entry]) => {
    inViewport.value = Boolean(entry?.isIntersecting)
    if (!inViewport.value) stopPlayback()
  }, { threshold: 0 })
  if (previewElement.value) observer.observe(previewElement.value)
})

onActivated(() => { active.value = true })
onDeactivated(() => {
  active.value = false
  stopPlayback()
})
onBeforeUnmount(() => {
  stopPlayback()
  observer?.disconnect()
  unregisterPlayback?.()
  document.removeEventListener('visibilitychange', onPageVisibilityChange)
  audioElement.value?.removeAttribute('src')
  audioElement.value?.load()
})

function formatTime(seconds: number) {
  const tenths = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`
}
</script>

<style scoped>
.sound-mini-preview { padding: 10px; border: 1px solid #d4e6f6; border-radius: 10px; background: #f0f7ff; }
.sound-mini-preview :deep(.waveform-panel) { padding: 0; border-radius: 0; background: transparent; }
.sound-mini-preview :deep(.waveform-heading), .sound-mini-preview :deep(.waveform-ticks) { display: none; }
.sound-mini-preview :deep(.waveform) { height: 60px; }
.sound-mini-preview :deep(.waveform-status) { padding: 0 6px; font-size: 11px; line-height: 1.5; }
.sound-mini-controls { display: flex; align-items: center; gap: 8px; margin-top: 8px; min-height: 30px; }
.sound-mini-play { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; padding: 0; border: 1px solid #b6d6f3; border-radius: 50%; background: #fff; color: #1976d2; }
.sound-mini-play:hover:not(:disabled) { background: #dceeff; border-color: #1976d2; }
.sound-mini-play svg { width: 16px; height: 16px; }
.sound-mini-loading { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #59677f; font-size: 11px; }
.sound-mini-time { margin-left: auto; color: #344c70; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sound-mini-time>span { color: #62718a; }
.sound-mini-error { margin: 7px 0 0; color: #b34242; font-size: 11px; line-height: 1.5; }
</style>
