<template>
  <button ref="trigger" type="button" class="resource-description resource-details-trigger"
    :class="{ 'is-pinned': pinned }"
    :aria-label="t('aiSearch.results.detailsLabel', { name: card.title })"
    :aria-expanded="opened" :aria-describedby="opened ? tooltipId : undefined"
    @pointerenter="enterTrigger" @pointerleave="leaveTrigger" @pointerdown="rememberPointer" @focus="show" @blur="blurTrigger" @click="toggleDetails" @wheel="scrollDetails">
    <span class="resource-details-summary">{{ summary }}</span><SearchIcon name="info" />
  </button>
  <Teleport to="body">
    <div v-if="opened" :id="tooltipId" ref="popover" class="resource-details-popover" :class="{ 'is-wide': wideDetails, 'is-pinned': pinned, 'is-touch': touchInteractive }" role="tooltip"
      :style="{ left: `${left}px`, top: `${top}px`, width: `${width}px`, visibility: positioned ? 'visible' : 'hidden' }"
      :tabindex="pinned && scrollable ? 0 : -1">
      <strong class="resource-details-title">{{ card.title }}</strong>
      <span class="resource-details-label">{{ t('aiSearch.results.detailsTitle') }}</span>
      <p class="resource-details-description">{{ card.description || t('aiSearch.noDescription') }}</p>
      <div v-if="card.keywords?.length" class="resource-details-keywords"><span class="resource-details-label">{{ t('aiSearch.results.keywords') }}</span><div class="resource-details-tags"><span v-for="keyword in card.keywords" :key="keyword">{{ keyword }}</span></div></div>
      <p v-if="card.matchReason" class="match-reason"><span class="resource-details-label">{{ t('aiSearch.matchReason') }}</span>{{ card.matchReason }}</p>
      <div v-if="card.suggestedUses?.length" class="suggested-uses"><span class="resource-details-label">{{ t('aiSearch.suggestedUses') }}</span><div class="resource-details-tags"><span v-for="use in card.suggestedUses" :key="use" class="use-tag">{{ use }}</span></div></div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ResourceCard } from '../types'
import SearchIcon from './SearchIcon.vue'

const props = defineProps<{ card: ResourceCard; detailId: string }>()
const { t } = useI18n({ useScope: 'global' })
const trigger = ref<HTMLButtonElement>()
const popover = ref<HTMLElement>()
const opened = ref(false)
const positioned = ref(false)
const top = ref(12)
const left = ref(12)
const width = ref(360)
const scrollable = ref(false)
const touchInteractive = ref(false)
const pinned = ref(false)
const wideDetails = computed(() => props.card.kind === 'bgm' || props.card.description.length > 320)
const tooltipId = computed(() => `resource-details-${props.detailId}`)
const summary = computed(() => (props.card.description || t('aiSearch.noDescription')).replace(/\s+/g, ' ').trim())
let triggerHovered = false
let hoverDismissed = false
let lastPointerType = ''
let generation = 0
let dismissFrame: number | undefined

function clearDismissFrame() {
  if (dismissFrame !== undefined) cancelAnimationFrame(dismissFrame)
  dismissFrame = undefined
}

async function show() {
  if (opened.value) return
  const request = ++generation
  const preferredWidth = props.card.kind === 'bgm' ? 720 : wideDetails.value ? 640 : 360
  width.value = Math.min(preferredWidth, Math.max(0, window.innerWidth - 24))
  scrollable.value = false
  positioned.value = false
  opened.value = true
  await nextTick()
  if (request !== generation || !opened.value || !trigger.value || !popover.value) return
  scrollable.value = popover.value.scrollHeight > popover.value.clientHeight
  await nextTick()
  if (request !== generation || !opened.value || !trigger.value || !popover.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const height = popover.value.getBoundingClientRect().height
  left.value = Math.max(12, Math.min(anchor.left, window.innerWidth - width.value - 12))
  const below = anchor.bottom + 8
  const preferredTop = below + height <= window.innerHeight - 12 ? below : anchor.top - height - 8
  top.value = Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12))
  positioned.value = true
}
function hide() {
  clearDismissFrame()
  generation += 1
  triggerHovered = false
  hoverDismissed = false
  pinned.value = false
  touchInteractive.value = false
  opened.value = positioned.value = false
}
function dismiss() {
  hide()
  hoverDismissed = true
  dismissFrame = requestAnimationFrame(() => {
    dismissFrame = undefined
    if (!trigger.value?.matches(':hover')) hoverDismissed = false
  })
}
function enterTrigger(event: PointerEvent) {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
  lastPointerType = event.pointerType
  if (!pinned.value) touchInteractive.value = false
  triggerHovered = true
  if (hoverDismissed) return
  void show()
}
function leaveTrigger(event: PointerEvent) {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
  triggerHovered = false
  hoverDismissed = false
  if (!pinned.value) hide()
}
function rememberPointer(event: PointerEvent) { lastPointerType = event.pointerType }
function blurTrigger() { if (!pinned.value && !triggerHovered) hide() }
function toggleDetails() {
  if (pinned.value) { dismiss(); return }
  hoverDismissed = false
  pinned.value = true
  touchInteractive.value = lastPointerType === 'touch'
  void show()
}
function scrollDetails(event: WheelEvent) {
  const panel = popover.value
  if (!opened.value || !panel || panel.scrollHeight <= panel.clientHeight || !event.deltaY) return
  const step = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? panel.clientHeight : 1
  panel.scrollTop += event.deltaY * step
  event.preventDefault()
  event.stopPropagation()
}
function pointerOutside(event: PointerEvent) {
  if (!opened.value || !(event.target instanceof Node)) return
  if (popover.value?.contains(event.target)) return
  if (!trigger.value?.contains(event.target)) hide()
}
function keyDown(event: KeyboardEvent) {
  if (!opened.value) return
  if (event.key === 'Escape') {
    if (document.activeElement === popover.value) trigger.value?.focus({ preventScroll: true })
    dismiss()
    event.preventDefault()
    return
  }
  const panel = popover.value
  if ((event.target !== trigger.value && event.target !== panel) || !panel || panel.scrollHeight <= panel.clientHeight) return
  const pageStep = panel.clientHeight * 0.8
  const targets: Record<string, number> = {
    ArrowDown: panel.scrollTop + 40, ArrowUp: panel.scrollTop - 40,
    PageDown: panel.scrollTop + pageStep, PageUp: panel.scrollTop - pageStep,
    Home: 0, End: panel.scrollHeight,
  }
  if (targets[event.key] !== undefined) { panel.scrollTop = targets[event.key]; event.preventDefault() }
}
function handleScroll(event: Event) {
  if (event.target instanceof Node && popover.value?.contains(event.target)) return
  hide()
}
function removeListeners() {
  document.removeEventListener('pointerdown', pointerOutside, true)
  document.removeEventListener('keydown', keyDown)
  document.removeEventListener('scroll', handleScroll, true)
  window.removeEventListener('resize', hide)
}
watch(opened, value => {
  if (!value) { removeListeners(); return }
  document.addEventListener('pointerdown', pointerOutside, true)
  document.addEventListener('keydown', keyDown)
  document.addEventListener('scroll', handleScroll, true)
  window.addEventListener('resize', hide)
})
watch(() => props.card, hide)
onBeforeUnmount(() => { clearDismissFrame(); generation += 1; removeListeners() })
</script>

<style scoped>
.resource-details-trigger { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; min-height: 24px; padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; }
.resource-details-trigger:hover, .resource-details-trigger[aria-expanded="true"] { color: #1976d2; }
.resource-details-summary { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-decoration: none; text-decoration-color: #1976d280; text-decoration-thickness: 1px; text-underline-offset: 3px; }
@media (hover: hover) {
  .resource-details-trigger:hover:not(.is-pinned) .resource-details-summary { text-decoration-line: underline; }
}
.resource-details-trigger svg { width: 13px; height: 13px; flex-shrink: 0; opacity: .75; }
.resource-details-popover { position: fixed; z-index: 1400; pointer-events: none; max-height: min(420px, 60dvh, calc(100dvh - 24px)); box-sizing: border-box; padding: 13px 15px; overflow-y: auto; overscroll-behavior: contain; border: 1px solid #cdd5e5; border-radius: 9px; background: #fff; box-shadow: 0 5px 24px #26324b26; color: #52617a; font-family: var(--app-font-family, sans-serif); font-size: 12px; font-weight: 400; line-height: 1.65; text-align: left; overflow-wrap: anywhere; user-select: none; scrollbar-width: thin; }
.resource-details-popover.is-pinned { pointer-events: auto; }
.resource-details-popover.is-touch { touch-action: pan-y; }
.resource-details-title { display: block; margin-bottom: 9px; color: #25324c; font-size: 13px; }
.resource-details-label { display: block; margin-bottom: 3px; color: #326ba9; font-size: 11px; font-weight: 600; }
.resource-details-description { margin: 0; white-space: pre-wrap; }
.resource-details-keywords, .match-reason, .suggested-uses { margin: 10px 0 0; }
.resource-details-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.resource-details-tags>span { padding: 2px 6px; border-radius: 4px; background: #f0f3f8; color: #52617a; font-size: 11px; }
.resource-details-tags>.use-tag { color: #126c54; background: #e6f4ed; }
</style>
