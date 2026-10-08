<template>
  <span class="response-details">
    <button ref="trigger" type="button" class="response-details-trigger" :aria-label="t('aiSearch.responseDetails.open')"
      :aria-expanded="opened" :aria-describedby="opened ? tooltipId : undefined"
      @pointerenter="enterTrigger" @pointerleave="leaveTrigger" @pointerdown="lastPointerType = $event.pointerType"
      @focus="focusTrigger" @blur="queueHide" @click="toggleDetails"><SearchIcon name="warning" /></button>
    <NPopover :show="opened" trigger="manual" placement="bottom" :x="popupX" :y="popupY" raw :show-arrow="false" :animated="false" :z-index="1500">
      <section :id="tooltipId" ref="panel" class="response-details-popup" role="tooltip"
        @pointerenter="enterPanel" @pointerleave="leavePanel" @pointerdown="startTextSelection" @focusin="show" @focusout="queueHide">
        <strong>{{ t('aiSearch.responseDetails.title') }}</strong>
        <pre tabindex="0" :aria-label="t('aiSearch.responseDetails.title')">{{ content }}</pre>
      </section>
    </NPopover>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NPopover } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import SearchIcon from './SearchIcon.vue'

const props = defineProps<{ content: string; detailId: string }>()
const { t } = useI18n({ useScope: 'global' })
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
const opened = ref(false)
const popupX = ref(0)
const popupY = ref(0)
const tooltipId = computed(() => 'response-details-' + props.detailId)
let triggerHovered = false
let panelHovered = false
let pinned = false
let lastPointerType = ''
let selectionPointerId: number | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

function clearCloseTimer() { if (closeTimer !== undefined) clearTimeout(closeTimer); closeTimer = undefined }
function show() {
  clearCloseTimer()
  const anchor = trigger.value?.getBoundingClientRect()
  if (anchor) {
    const halfWidth = Math.min(560, window.innerWidth - 24) / 2
    popupX.value = Math.max(12 + halfWidth, Math.min(window.innerWidth - halfWidth - 12, anchor.left + anchor.width / 2))
    popupY.value = anchor.bottom + 6
  }
  opened.value = true
}
function hide() { clearCloseTimer(); pinned = false; selectionPointerId = undefined; opened.value = false }
function queueHide() {
  clearCloseTimer()
  closeTimer = setTimeout(() => {
    const focused = document.activeElement
    if (selectionPointerId === undefined && !hasPanelSelection() && !pinned && !triggerHovered && !panelHovered && !trigger.value?.contains(focused) && !panel.value?.contains(focused)) hide()
  }, 120)
}
function hasPanelSelection() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount || !panel.value) return false
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(panel.value)) return true
  }
  return false
}
function startTextSelection(event: PointerEvent) {
  if (event.button !== 0) return
  selectionPointerId = event.pointerId
  clearCloseTimer()
}
function finishTextSelection(event: PointerEvent) {
  if (selectionPointerId !== event.pointerId) return
  selectionPointerId = undefined
  queueHide()
}
function selectionChanged() { if (selectionPointerId === undefined && !hasPanelSelection()) queueHide() }
function enterTrigger(event: PointerEvent) {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
  triggerHovered = true
  lastPointerType = event.pointerType
  show()
}
function leaveTrigger(event: PointerEvent) {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
  triggerHovered = false
  queueHide()
}
function enterPanel(event: PointerEvent) { if (event.pointerType === 'mouse' || event.pointerType === 'pen') { panelHovered = true; show() } }
function leavePanel(event: PointerEvent) { if (event.pointerType === 'mouse' || event.pointerType === 'pen') { panelHovered = false; queueHide() } }
function focusTrigger() { if (lastPointerType !== 'touch') show() }
function toggleDetails(event: MouseEvent) {
  if (event.detail === 0 || lastPointerType === 'touch') {
    if (pinned) { hide(); return }
    pinned = true
  }
  show()
}
function pointerOutside(event: PointerEvent) {
  if (event.target instanceof Node && !trigger.value?.contains(event.target) && !panel.value?.contains(event.target)) hide()
}
function keyDown(event: KeyboardEvent) { if (event.key === 'Escape') { hide(); event.preventDefault() } }
function handleScroll(event: Event) { if (selectionPointerId !== undefined || hasPanelSelection()) return; if (!(event.target instanceof Node) || !panel.value?.contains(event.target)) hide() }
function removeListeners() {
  document.removeEventListener('pointerdown', pointerOutside, true)
  document.removeEventListener('keydown', keyDown)
  document.removeEventListener('pointerup', finishTextSelection, true)
  document.removeEventListener('pointercancel', finishTextSelection, true)
  document.removeEventListener('selectionchange', selectionChanged)
  document.removeEventListener('scroll', handleScroll, true)
  window.removeEventListener('resize', hide)
}
watch(opened, value => {
  if (!value) { panelHovered = false; removeListeners(); return }
  document.addEventListener('pointerdown', pointerOutside, true)
  document.addEventListener('keydown', keyDown)
  document.addEventListener('pointerup', finishTextSelection, true)
  document.addEventListener('pointercancel', finishTextSelection, true)
  document.addEventListener('selectionchange', selectionChanged)
  document.addEventListener('scroll', handleScroll, true)
  window.addEventListener('resize', hide)
})
watch(() => props.content, hide)
onBeforeUnmount(() => { clearCloseTimer(); removeListeners() })
</script>

<style scoped>
.response-details-trigger { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; margin: 0 0 0 7px; padding: 1px; vertical-align: text-bottom; border: 0; border-radius: 50%; background: transparent; color: #b22a48; cursor: help; }
.response-details-trigger svg { width: 16px; height: 16px; }
.response-details-trigger:hover, .response-details-trigger[aria-expanded="true"] { background: #b22a4810; }
.response-details-trigger:focus-visible { outline: 2px solid #b22a4866; outline-offset: 2px; }
.response-details-popup { box-sizing: border-box; width: min(560px, calc(100vw - 24px)); padding: 12px 14px; border: 1px solid #cdd5e5; border-radius: 9px; background: #fff; box-shadow: 0 5px 24px #26324b26; color: #52617a; font-family: var(--app-font-family, sans-serif); font-size: 12px; line-height: 1.65; text-align: left; }
.response-details-popup strong { display: block; margin-bottom: 8px; color: #25324c; font-size: 13px; font-weight: 600; }
.response-details-popup pre { margin: 0; padding: 9px 10px; max-height: min(360px, calc(100dvh - 100px)); overflow: auto; overscroll-behavior: contain; border: 1px solid #e3e8f1; border-radius: 6px; background: #f7f9fc; color: #344c70; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; scrollbar-width: thin; }
.response-details-popup pre:focus-visible { outline: 2px solid #1976d266; outline-offset: 2px; }
</style>
