<template>
  <div ref="container" class="resource-mini-preview">
    <SoundMiniPreview v-if="media?.kind === 'sound'" :src="media.src" :title="card.title" :duration="card.duration" />
    <EffectMiniPreview v-else-if="media?.kind === 'effect'" :item="media.item" :title="card.title" />
    <BgmMiniPreview v-else-if="media?.kind === 'bgm'" :song-id="media.songId" :album-id="media.albumId" :title="card.title"
      :duration="media.duration || card.duration" :album="album" />
    <p v-else-if="loading" class="preview-status" role="status">{{ t('aiSearch.preview.loading') }}</p>
    <p v-else-if="unavailable" class="preview-status" role="status">{{ t('aiSearch.preview.unavailable') }}
      <button v-if="failed" type="button" @click="load">{{ t('aiSearch.preview.retry') }}</button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ResourceCard } from '../types'
import { loadPreviewMedia, type PreviewMedia } from '../previewMedia'
import SoundMiniPreview from './SoundMiniPreview.vue'
import EffectMiniPreview from './EffectMiniPreview.vue'
import BgmMiniPreview from './BgmMiniPreview.vue'

const props = defineProps<{ card: ResourceCard }>()
const { t, te } = useI18n({ useScope: 'global' })
const container = ref<HTMLElement>()
const media = shallowRef<PreviewMedia | null>(null)
const visible = ref(false)
const loading = ref(false)
const unavailable = ref(false)
const failed = ref(false)
const album = computed(() => {
  const key = media.value?.kind === 'bgm' ? media.value.albumI18nKey : undefined
  return key && te(key) ? t(key) : ''
})
let observer: IntersectionObserver | undefined
let generation = 0
async function load() {
  const request = ++generation
  loading.value = true
  unavailable.value = false
  failed.value = false
  try {
    const result = await loadPreviewMedia(props.card)
    if (request !== generation) return
    media.value = result
    unavailable.value = !result
  } catch {
    if (request !== generation) return
    unavailable.value = failed.value = true
  } finally { if (request === generation) loading.value = false }
}
watch(() => props.card.resourceId, () => {
  generation += 1
  media.value = null
  loading.value = unavailable.value = failed.value = false
  if (visible.value) void load()
})
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { visible.value = true; void load(); return }
  observer = new IntersectionObserver(([entry]) => {
    visible.value = Boolean(entry?.isIntersecting)
    if (visible.value && !media.value && !loading.value && !unavailable.value) void load()
  })
  if (container.value) observer.observe(container.value)
})
onBeforeUnmount(() => { generation += 1; observer?.disconnect() })
</script>

<style scoped>
.resource-mini-preview { min-height: 42px; margin: 5px 0 12px; }
.preview-status { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 0; padding: 12px; border-radius: 8px; background: #f3f6fa; color: #66738a; font-size: 12px; line-height: 1.5; }
.preview-status button { border: 0; padding: 0; background: none; color: #245ec9; text-decoration: underline; }
</style>
