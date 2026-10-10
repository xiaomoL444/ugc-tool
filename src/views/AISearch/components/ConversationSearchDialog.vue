<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchIcon from './SearchIcon.vue'
import type { ChatMessage, Conversation } from '../types'

const props = defineProps<{ conversations: Conversation[]; activeConversationId: string; disabled?: boolean }>()
const emit = defineEmits<{ (event: 'select', id: string, messageId?: string): void; (event: 'update:open', open: boolean): void }>()
const { t, locale } = useI18n({ useScope: 'global' })
const dialog = ref<HTMLDialogElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const resultList = ref<HTMLUListElement | null>(null)
const query = ref('')
const opened = ref(false)
const selectedIndex = ref(0)
const composing = ref(false)
const backdropStarts = new WeakSet<HTMLDialogElement>()
let previousFocus: HTMLElement | null = null
let showGeneration = 0

type SearchResult = { conversation: Conversation; messageId?: string; summary: string }
const terms = computed(() => [...new Set(query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))])
const hasQuery = computed(() => terms.value.length > 0)

function visibleFields(message: ChatMessage): string[] {
  return [message.content, ...message.cards.flatMap(card => [
    card.title, card.description, card.id, t(`aiSearch.scopes.${card.kind}`),
    ...(card.keywords || []), ...(card.suggestedUses || []), card.matchReason || '',
  ])].filter(text => text.trim())
}
function includesAll(text: string) {
  const normalized = text.toLocaleLowerCase()
  return terms.value.every(term => normalized.includes(term))
}
function includesAny(text: string) {
  const normalized = text.toLocaleLowerCase()
  return terms.value.some(term => normalized.includes(term))
}
const results = computed<SearchResult[]>(() => {
  const sorted = [...props.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  return sorted.flatMap(conversation => {
    const messages = [...conversation.messages].reverse().map(message => ({ message, fields: visibleFields(message) }))
    const recentSummary = messages.find(item => item.fields.length)?.fields[0] || t('aiSearch.historySearch.noMessages')
    if (!hasQuery.value) return [{ conversation, summary: recentSummary }]
    if (includesAll(conversation.title)) return [{ conversation, summary: recentSummary }]
    if (!includesAll([conversation.title, ...messages.flatMap(item => item.fields)].join('\n'))) return []
    const match = messages.find(item => includesAll(item.fields.join('\n'))) || messages.find(item => item.fields.some(includesAny))
    const summary = match?.fields.find(includesAll) || match?.fields.find(includesAny) || recentSummary
    return [{ conversation, messageId: match?.message.id, summary }]
  })
})

const highlightPattern = computed(() => {
  if (!hasQuery.value) return null
  const escaped = [...terms.value].sort((a, b) => b.length - a.length).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(escaped.join('|'), 'giu')
})
function snippet(text: string) {
  const plain = text.replace(/\s+/g, ' ').trim()
  const firstMatch = highlightPattern.value ? plain.search(highlightPattern.value) : -1
  const start = Math.max(0, firstMatch - 54)
  const end = Math.min(plain.length, start + 190)
  return `${start ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`
}
function highlight(text: string): { text: string; matched: boolean }[] {
  const pattern = highlightPattern.value
  if (!pattern) return [{ text, matched: false }]
  const parts: { text: string; matched: boolean }[] = []
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > offset) parts.push({ text: text.slice(offset, index), matched: false })
    parts.push({ text: match[0], matched: true })
    offset = index + match[0].length
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), matched: false })
  return parts
}
function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(timestamp)
}

async function show() {
  if (props.disabled || !dialog.value) return
  if (dialog.value.open) { searchInput.value?.focus({ preventScroll: true }); return }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  query.value = ''
  selectedIndex.value = 0
  composing.value = false
  backdropStarts.delete(dialog.value)
  const generation = ++showGeneration
  await nextTick()
  if (generation !== showGeneration || props.disabled || !dialog.value) return
  dialog.value.showModal()
  opened.value = true
  emit('update:open', true)
  searchInput.value?.focus({ preventScroll: true })
  if (resultList.value) resultList.value.scrollTop = 0
}
function finishClose() {
  if (opened.value) { opened.value = false; emit('update:open', false) }
  composing.value = false
  const target = previousFocus
  previousFocus = null
  if (target?.isConnected) target.focus({ preventScroll: true })
}
function close() {
  ++showGeneration
  if (dialog.value) backdropStarts.delete(dialog.value)
  dialog.value?.close()
  finishClose()
}
function onNativeClose() {
  if (dialog.value?.open) return
  ++showGeneration
  finishClose()
}
function select(result: SearchResult | undefined) {
  if (!result || props.disabled) return
  close()
  emit('select', result.conversation.id, result.messageId)
}
function isBackdrop(event: MouseEvent) {
  if (event.target !== event.currentTarget) return false
  const bounds = (event.currentTarget as HTMLDialogElement).getBoundingClientRect()
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
}
function trackPointerDown(event: PointerEvent) {
  const target = event.currentTarget as HTMLDialogElement
  backdropStarts.delete(target)
  if (event.button === 0 && event.isPrimary && isBackdrop(event)) backdropStarts.add(target)
}
function onBackdropClick(event: MouseEvent) {
  const target = event.currentTarget as HTMLDialogElement
  const startedOnBackdrop = backdropStarts.has(target)
  backdropStarts.delete(target)
  if (startedOnBackdrop && isBackdrop(event)) close()
}
async function revealSelected(focus = false) {
  await nextTick()
  const list = resultList.value
  const button = list?.querySelectorAll<HTMLButtonElement>('.history-search-result')[selectedIndex.value]
  if (!list || !button) return
  const bounds = list.getBoundingClientRect()
  const item = button.getBoundingClientRect()
  if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top
  else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom
  if (focus) button.focus({ preventScroll: true })
}
function onKeydown(event: KeyboardEvent) {
  if (composing.value || event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  const target = event.target as HTMLElement
  const fromInput = target === searchInput.value
  const fromResult = Boolean(target.closest('.history-search-result'))
  if (!fromInput && !fromResult) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = Math.max(0, Math.min(results.value.length - 1, selectedIndex.value + (event.key === 'ArrowDown' ? 1 : -1)))
    void revealSelected(fromResult)
  } else if (event.key === 'Enter' && fromInput) {
    event.preventDefault()
    select(results.value[selectedIndex.value])
  }
}
watch(results, () => { selectedIndex.value = 0; if (resultList.value) resultList.value.scrollTop = 0 })
onBeforeUnmount(close)
defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <dialog id="ai-history-search-dialog" ref="dialog" class="history-search-dialog" aria-labelledby="history-search-title"
      @cancel.prevent.stop="close" @close="onNativeClose" @keydown.stop="onKeydown" @keyup.stop
      @pointerdown.capture="trackPointerDown" @pointercancel="backdropStarts.delete($event.currentTarget as HTMLDialogElement)"
      @click="onBackdropClick">
      <h2 id="history-search-title" class="history-search-sr-only">{{ t('aiSearch.historySearch.title') }}</h2>
      <div class="history-search-header">
        <svg class="history-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input ref="searchInput" v-model="query" class="history-search-input" type="search" autofocus autocomplete="off"
          :placeholder="t('aiSearch.historySearch.placeholder')" :aria-label="t('aiSearch.historySearch.title')"
          @compositionstart="composing = true" @compositionend="composing = false" />
        <button type="button" class="history-search-close" :aria-label="t('aiSearch.historySearch.close')"
          :title="t('aiSearch.historySearch.close')" @click="close"><SearchIcon name="close" /></button>
      </div>
      <div class="history-search-caption" aria-live="polite">
        <span>{{ t(hasQuery ? 'aiSearch.historySearch.results' : 'aiSearch.historySearch.recent') }}</span>
        <span>{{ t('aiSearch.historySearch.resultCount', { count: results.length }) }}</span>
      </div>
      <ul v-if="results.length" ref="resultList" class="history-search-results">
        <li v-for="(result, index) in results" :key="result.conversation.id">
          <button type="button" class="history-search-result" :class="{ 'is-highlighted': index === selectedIndex, 'is-current': result.conversation.id === activeConversationId }"
            :data-conversation-id="result.conversation.id" :data-message-id="result.messageId" :disabled="disabled"
            @mouseenter="selectedIndex = index" @focus="selectedIndex = index" @click="select(result)">
            <span class="history-search-result-heading">
              <strong class="history-search-result-title"><template v-for="(part, partIndex) in highlight(result.conversation.title)" :key="partIndex"><mark v-if="part.matched">{{ part.text }}</mark><span v-else>{{ part.text }}</span></template></strong>
              <span v-if="result.conversation.id === activeConversationId" class="history-search-current">{{ t('aiSearch.historySearch.current') }}</span>
            </span>
            <span class="history-search-result-summary"><template v-for="(part, partIndex) in highlight(snippet(result.summary))" :key="partIndex"><mark v-if="part.matched">{{ part.text }}</mark><span v-else>{{ part.text }}</span></template></span>
            <time class="history-search-result-date" :datetime="new Date(result.conversation.updatedAt).toISOString()">{{ dateLabel(result.conversation.updatedAt) }}</time>
          </button>
        </li>
      </ul>
      <p v-else class="history-search-empty">{{ t(hasQuery ? 'aiSearch.historySearch.noResults' : 'aiSearch.historySearch.empty') }}</p>
      <footer class="history-search-footer">{{ t('aiSearch.historySearch.shortcutHint') }}</footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.history-search-dialog { box-sizing: border-box; width: min(680px, calc(100vw - 32px)); height: min(560px, 70vh); height: min(560px, 70dvh); max-width: none; max-height: none; margin: auto; padding: 0; border: 1px solid #c9dcf0; border-radius: 16px; background: #f5f8fd; color: #244463; font-family: var(--app-font-family); box-shadow: 0 24px 80px #17365240; overflow: hidden; }
.history-search-dialog[open] { display: flex; flex-direction: column; }
.history-search-dialog::backdrop { background: #17365266; backdrop-filter: blur(3px); }
.history-search-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.history-search-header { display: flex; align-items: center; flex-shrink: 0; gap: 12px; padding: 16px; border-bottom: 1px solid #dce7f4; background: #fff; }
.history-search-icon { flex-shrink: 0; width: 22px; height: 22px; color: #1976d2; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
.history-search-input { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid #c9dcf0; border-radius: 8px; background: #f8fbff; color: #244463; font: inherit; font-size: 15px; font-weight: 400; user-select: text; }
.history-search-input::placeholder { color: #70869d; }
.history-search-close { display: grid; place-items: center; flex-shrink: 0; box-sizing: border-box; width: 34px; height: 34px; padding: 0; border: 1px solid #c9dcf0; border-radius: 8px; background: #f5f8fd; color: #466c92; line-height: 1; cursor: pointer; }
.history-search-close svg { display: block; width: 20px; height: 20px; }
.history-search-close:hover { background: #e8f2ff; }
.history-search-caption { display: flex; justify-content: space-between; flex-shrink: 0; gap: 12px; padding: 13px 18px 7px; color: #647f9b; font-size: 12px; }
.history-search-results { flex: 1; min-height: 0; margin: 0; padding: 3px 10px 10px; list-style: none; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.history-search-results li { margin: 0; padding: 0; }
.history-search-result { display: flex; flex-direction: column; box-sizing: border-box; width: 100%; gap: 7px; margin: 3px 0; padding: 12px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.history-search-result:hover, .history-search-result.is-highlighted { border-color: #bdd9f5; background: #e8f2ff; }
.history-search-result:disabled { opacity: .55; cursor: default; }
.history-search-input:focus-visible, .history-search-close:focus-visible, .history-search-result:focus-visible { outline: 2px solid #1976d2; outline-offset: 2px; }
.history-search-result-heading { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; }
.history-search-result-title { min-width: 0; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.history-search-current { flex-shrink: 0; margin-left: auto; padding: 2px 6px; border-radius: 5px; background: #d5e8ff; color: #25649f; font-size: 11px; font-weight: 400; }
.history-search-result-summary { display: -webkit-box; max-width: 100%; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; color: #4d6b89; font-size: 13px; line-height: 1.55; }
.history-search-result-date { color: #70869d; font-size: 11px; font-weight: 400; }
.history-search-result mark { padding: 0; border-radius: 2px; background: #c4e0ff; color: #125b9e; }
.history-search-empty { display: grid; flex: 1; place-items: center; margin: 0; padding: 30px; color: #647f9b; font-size: 14px; text-align: center; }
.history-search-footer { flex-shrink: 0; padding: 10px 18px; border-top: 1px solid #dce7f4; color: #70869d; font-size: 11px; }
@media (max-width: 480px) { .history-search-header { gap: 8px; padding: 12px; } .history-search-icon { width: 18px; height: 18px; } .history-search-input { font-size: 16px; } .history-search-result-heading { flex-wrap: wrap; gap: 5px; } .history-search-current { margin-left: 0; } }
</style>
