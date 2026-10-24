<template>
  <div ref="host" class="animation-media" :class="`is-${variant}`" data-animation-preview>
    <div ref="mediaHost" class="media-element" />
    <div v-if="failed" class="media-status has-error" role="status">
      <span>{{ t('animationViewer.media.failed') }}</span>
      <button type="button" @click.stop="retry">{{ t('animationViewer.media.retry') }}</button>
    </div>
    <div v-else-if="autoplayBlocked" class="media-status" role="status">
      <span>{{ t('animationViewer.media.autoplayBlocked') }}</span>
    </div>
    <div v-else-if="!ready" class="media-status" role="status">
      <span>{{ t('animationViewer.media.loading') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { acquireAnimationMedia, tryAcquireCachedAnimationMedia, type CachedAnimationMedia } from './cachedAnimationMedia';
import type { AnimationPart } from './animationData';

const props = withDefaults(defineProps<{
  part: AnimationPart;
  title: string;
  suspended?: boolean;
  variant?: 'card' | 'modal';
  cacheKey?: string;
}>(), { suspended: false, variant: 'card', cacheKey: '' });
const { t } = useI18n({ useScope: 'global' });
const host = ref<HTMLElement | null>(null);
const mediaHost = ref<HTMLElement | null>(null);
const visible = ref(props.variant === 'modal');
const nearby = ref(props.variant === 'modal');
const pageVisible = ref(true);
const media = shallowRef<CachedAnimationMedia | null>(null);
const ready = computed(() => media.value?.state.ready ?? false);
const failed = computed(() => media.value?.state.failed ?? false);
const autoplayBlocked = computed(() => media.value?.state.autoplayBlocked ?? false);
const active = computed(() => visible.value && pageVisible.value && !props.suspended);
let lease: ReturnType<typeof acquireAnimationMedia> | null = null;
let observer: IntersectionObserver | undefined;
let preloadObserver: IntersectionObserver | undefined;
let mounted = false;
let disposed = false;

function attachMedia(nextLease: ReturnType<typeof acquireAnimationMedia>) {
  lease = nextLease;
  media.value = lease.value;
  media.value.configure(props.title);
  mediaHost.value?.append(media.value.element);
}
function restoreCachedMedia() {
  if (lease) return;
  const cached = tryAcquireCachedAnimationMedia(props.part.path, props.variant, props.cacheKey);
  // Failed media keeps the existing visibility-gated retry behavior.
  if (cached?.value.state.failed) cached.release();
  else if (cached) attachMedia(cached);
}
function updatePlayback() {
  if (!mounted || disposed) return;
  if (!lease && (nearby.value || visible.value)) {
    attachMedia(acquireAnimationMedia(props.part.path, props.variant, props.cacheKey));
    if (media.value?.state.failed) media.value.retry();
  }
  media.value?.setActive(active.value);
}
function releaseMedia() {
  media.value?.park();
  lease?.release();
  lease = null;
  media.value = null;
}
function retry() { media.value?.retry(); }
function visibilityChanged() { pageVisible.value = !document.hidden; }
watch([active, nearby], updatePlayback);
watch(() => props.title, title => { media.value?.configure(title); });
watch(() => [props.part.path, props.variant, props.cacheKey] as const, () => {
  releaseMedia();
  if (mounted && !disposed) restoreCachedMedia();
  updatePlayback();
});
onMounted(() => {
  mounted = true;
  visibilityChanged();
  document.addEventListener('visibilitychange', visibilityChanged);
  // Reattach cache hits before the first paint, rather than showing a loading
  // placeholder while waiting for IntersectionObserver. A miss creates nothing.
  restoreCachedMedia();
  if (props.variant !== 'modal' && typeof IntersectionObserver !== 'undefined') {
    const root = host.value?.closest('.animation-virtual-list') ?? host.value?.closest('.library-content') ?? null;
    // Real viewport visibility controls playback. Overscan only warms buffers.
    observer = new IntersectionObserver(([entry]) => { visible.value = entry.isIntersecting; }, { root });
    preloadObserver = new IntersectionObserver(([entry]) => { nearby.value = entry.isIntersecting; }, {
      root, rootMargin: '240px 0px',
    });
    if (host.value) {
      observer.observe(host.value);
      preloadObserver.observe(host.value);
    }
  } else { visible.value = true; nearby.value = true; }
  updatePlayback();
});
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  preloadObserver?.disconnect();
  document.removeEventListener('visibilitychange', visibilityChanged);
  releaseMedia();
});
</script>

<style scoped>
.animation-media { position: relative; aspect-ratio: 4 / 3; width: 100%; overflow: hidden; background: #202536; }
.animation-media.is-modal { aspect-ratio: 16 / 9; }
.media-element { width: 100%; height: 100%; }
.media-element :deep(video) { display: block; width: 100%; height: 100%; object-fit: contain; }
.media-status { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 12px; box-sizing: border-box; color: #b9c3da; text-align: center; font-size: 0.75rem; pointer-events: none; }
.media-status.has-error { z-index: 2; background: #202536; }
.media-status button { pointer-events: auto; font: inherit; color: #e6eaff; border: 1px solid #697592; border-radius: 6px; padding: 5px 9px; background: #303a52; cursor: pointer; }
.media-status button:focus-visible { outline: 2px solid #a8bdff; outline-offset: 2px; }
</style>
