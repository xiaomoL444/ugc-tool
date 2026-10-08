<template>
  <section ref="container" class="resource-results">
    <div ref="toolbar" class="results-toolbar">
      <div class="results-heading"><span>{{ t('aiSearch.resultCount', { count: cards.length }) }}</span><span class="results-line"></span></div>
      <nav v-if="pageCount > 1" class="result-pagination" :aria-label="t('aiSearch.results.paginationLabel')">
        <button type="button" class="results-previous" :aria-controls="gridId" :disabled="pageIndex === 0" @click="changePage(-1)">{{ t('aiSearch.results.previousPage') }}</button>
        <span class="results-page-status" role="status" aria-live="polite" aria-atomic="true">{{ t('aiSearch.results.pageStatus', { page: pageIndex + 1, pages: pageCount, start: startIndex + 1, end: startIndex + visibleCards.length, count: cards.length }) }}</span>
        <button type="button" class="results-next" :aria-controls="gridId" :disabled="pageIndex >= pageCount - 1" @click="changePage(1)">{{ t('aiSearch.results.nextPage') }}</button>
      </nav>
    </div>
    <div :id="gridId" ref="grid" class="result-grid" :style="{ gridTemplateColumns: `repeat(${pageSize}, minmax(0, 1fr))`, minHeight: minimumGridHeight ? `${minimumGridHeight}px` : undefined }">
      <article v-for="(card, index) in visibleCards" :key="card.resourceId" class="resource-card" :class="`resource-${card.kind}`" :data-effect-card="card.kind === 'effect' ? '' : undefined" :data-result-position="startIndex + index + 1">
        <div class="resource-heading"><span class="resource-position" :aria-label="t('aiSearch.results.resultPosition', { position: startIndex + index + 1 })">{{ startIndex + index + 1 }}</span><span class="resource-icon"><SearchIcon :name="card.kind === 'sound' ? 'sound' : card.kind === 'bgm' ? 'music' : 'effect'" /></span><span class="resource-kind">{{ t(`aiSearch.scopes.${card.kind}`) }}</span><span class="resource-id">{{ t('aiSearch.assetId') }} {{ card.id }}</span></div>
        <div class="resource-title-row"><h3 :title="card.title">{{ card.title }}</h3><span v-if="card.matchType === 'suggestion'" class="suggestion-match">{{ t('aiSearch.suggestedUses') }}</span></div>
        <div v-if="card.audioMatch" class="resource-match-badges"><span class="audio-match"><SearchIcon name="sound" />{{ t('aiSearch.audioMatch') }}</span></div>
        <div class="resource-copy-actions"><button type="button" @click="Clipboard(card.id)"><SearchIcon name="copy" />{{ t('aiSearch.preview.copyId') }}</button><button type="button" @click="Clipboard(card.title)"><SearchIcon name="copy" />{{ t('aiSearch.preview.copyName') }}</button></div>
        <ResourceMiniPreview :card="card" />
        <ResourceDetails :card="card" :detail-id="`${resultId}-${card.resourceId}`" />
        <a :href="card.href" class="asset-link" target="_blank" rel="noopener noreferrer"><span>{{ t('aiSearch.openAsset') }}</span><SearchIcon name="external" /></a>
      </article>
    </div>
    <p class="result-notice">{{ t('aiSearch.resultNotice') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clipboard } from '@/utils/clipboard'
import type { ResourceCard } from '../types'
import SearchIcon from './SearchIcon.vue'
import ResourceMiniPreview from './ResourceMiniPreview.vue'
import ResourceDetails from './ResourceDetails.vue'

const props = defineProps<{ cards: ResourceCard[]; resultId: string }>()
const { t } = useI18n({ useScope: 'global' })
const container = ref<HTMLElement>()
const toolbar = ref<HTMLElement>()
const grid = ref<HTMLElement>()
const minimumGridHeight = ref(0)
const pageSize = ref(1)
const pageIndex = ref(0)
const gridId = computed(() => `resource-results-${props.resultId}`)
const pageCount = computed(() => Math.max(1, Math.ceil(props.cards.length / pageSize.value)))
const startIndex = computed(() => pageIndex.value * pageSize.value)
const visibleCards = computed(() => props.cards.slice(startIndex.value, startIndex.value + pageSize.value))
let resizeObserver: ResizeObserver | undefined
let gridObserver: ResizeObserver | undefined
let measuredWidth = 0
let pageChangeRevision = 0

function rememberGridHeight() {
  const height = grid.value?.getBoundingClientRect().height ?? 0
  if (height > minimumGridHeight.value) minimumGridHeight.value = Math.ceil(height)
}

function updatePageSize(width: number) {
  if (width <= 0) return
  // Keep compact cards at least 240px wide, separated by 12px, in one row.
  const nextSize = window.innerWidth <= 600 ? 1 : Math.max(1, Math.min(6, Math.floor((width + 12) / 252)))
  const widthChanged = Math.abs(width - measuredWidth) > 1
  if (!widthChanged && nextSize === pageSize.value) return
  measuredWidth = width
  // Re-measure when cards reflow; old wide/narrow layouts do not reserve space forever.
  minimumGridHeight.value = 0
  const firstVisibleIndex = startIndex.value
  pageSize.value = nextSize
  pageIndex.value = Math.min(pageCount.value - 1, Math.floor(firstVisibleIndex / nextSize))
  void nextTick(rememberGridHeight)
}
async function changePage(offset: number) {
  const nextPage = Math.max(0, Math.min(pageCount.value - 1, pageIndex.value + offset))
  if (nextPage === pageIndex.value) return
  const viewport = container.value?.closest<HTMLElement>('.message-viewport')
  const anchorTop = toolbar.value?.getBoundingClientRect().top
  const revision = ++pageChangeRevision
  // Preserve the row before removing its cards, including the short last page.
  rememberGridHeight()
  pageIndex.value = nextPage
  await nextTick()
  if (revision !== pageChangeRevision) return
  rememberGridHeight()
  await nextTick()
  if (revision !== pageChangeRevision || !viewport || anchorTop === undefined || !toolbar.value) return
  const movement = toolbar.value.getBoundingClientRect().top - anchorTop
  if (Math.abs(movement) > .5) viewport.scrollTop += movement
}
watch(() => props.cards, () => { ++pageChangeRevision; minimumGridHeight.value = 0; pageIndex.value = 0; void nextTick(rememberGridHeight) })
watch(pageCount, count => { pageIndex.value = Math.min(pageIndex.value, count - 1) })
onMounted(() => {
  const element = container.value
  if (!element) return
  updatePageSize(element.getBoundingClientRect().width)
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(entries => { updatePageSize(entries[0]?.contentRect.width || 0) })
  resizeObserver.observe(element)
  if (grid.value) {
    // Waveforms, effects and BGM can finish loading after the page has switched.
    gridObserver = new ResizeObserver(rememberGridHeight)
    gridObserver.observe(grid.value)
  }
})
onBeforeUnmount(() => { ++pageChangeRevision; resizeObserver?.disconnect(); gridObserver?.disconnect() })
</script>
