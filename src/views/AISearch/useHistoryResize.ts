import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 220
const MAX_WIDTH = 420
const CHAT_MIN_WIDTH = 360
const DIVIDER_WIDTH = 14

export function useHistoryResize(workspace: Ref<HTMLElement | undefined>, collapsed: Ref<boolean>) {
  const requestedWidth = ref(DEFAULT_WIDTH)
  const workspaceWidth = ref(0)
  const resizingHistory = ref(false)
  const historyMaxWidth = computed(() => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH,
    workspaceWidth.value ? workspaceWidth.value - CHAT_MIN_WIDTH - DIVIDER_WIDTH : MAX_WIDTH)))
  const clamp = (width: number) => Math.round(Math.min(historyMaxWidth.value, Math.max(MIN_WIDTH, width)))
  const historyWidth = computed(() => clamp(requestedWidth.value))
  let observer: ResizeObserver | undefined
  let drag: { pointerId: number; startX: number; startWidth: number; target: HTMLElement } | undefined

  function finishHistoryResize(event?: PointerEvent) {
    if (!drag || event && event.pointerId !== drag.pointerId) return
    const active = drag
    drag = undefined
    resizingHistory.value = false
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
  }
  function startHistoryResize(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || collapsed.value || window.innerWidth <= 860) return
    finishHistoryResize()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: historyWidth.value, target }
    resizingHistory.value = true
    target.focus({ preventScroll: true })
    event.preventDefault()
  }
  function moveHistoryResize(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return
    requestedWidth.value = clamp(drag.startWidth + event.clientX - drag.startX)
    event.preventDefault()
  }
  function resetHistoryWidth() { requestedWidth.value = DEFAULT_WIDTH }
  function handleHistoryResizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 32 : 8
    const next = event.key === 'ArrowLeft' ? historyWidth.value - step
      : event.key === 'ArrowRight' ? historyWidth.value + step
      : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? historyMaxWidth.value : undefined
    if (next === undefined) return
    event.preventDefault()
    requestedWidth.value = clamp(next)
  }
  watch(collapsed, () => finishHistoryResize())
  onMounted(() => {
    if (!workspace.value) return
    workspaceWidth.value = workspace.value.clientWidth
    observer = new ResizeObserver(entries => {
      workspaceWidth.value = entries[0]?.contentRect.width || workspace.value?.clientWidth || 0
      if (window.innerWidth <= 860) finishHistoryResize()
    })
    observer.observe(workspace.value)
  })
  onBeforeUnmount(() => { finishHistoryResize(); observer?.disconnect() })
  return { historyWidth, historyMaxWidth, resizingHistory, startHistoryResize, moveHistoryResize,
    finishHistoryResize, handleHistoryResizeKey, resetHistoryWidth }
}
