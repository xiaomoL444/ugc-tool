<template>
  <div ref="workspace" class="ai-search-workspace" :class="{ 'is-history-collapsed': historyCollapsed, 'is-resizing': resizingHistory }" :style="{ '--ai-history-width': `${historyWidth}px` }">
    <button v-if="historyOpen" class="history-backdrop" :aria-label="t('aiSearch.closeHistory')" @click="historyOpen = false"></button>
    <aside id="ai-search-history-panel" class="search-sidebar" :class="{ 'is-open': historyOpen, 'is-collapsed': historyCollapsed }" aria-labelledby="ai-history-title">
      <div class="sidebar-brand"><h2 id="ai-history-title">{{ t('aiSearch.history') }}</h2><span class="history-count">{{ conversations.length }}</span><button class="icon-button mobile-close" :aria-label="t('aiSearch.closeHistory')" @click="historyOpen = false"><SearchIcon name="close" /></button></div>
      <button class="new-conversation" :disabled="busy || loadingArchive" @click="startConversation"><SearchIcon name="plus" />{{ t('aiSearch.newConversation') }}</button>
      <div class="conversation-list">
        <p v-if="!conversations.length" class="history-empty">{{ t('aiSearch.historyEmpty') }}</p>
        <div v-for="conversation in conversations" :key="conversation.id" class="conversation-row" :class="{ active: conversation.id === activeConversationId }">
          <button class="conversation-select" :disabled="busy || loadingArchive" @click="openConversation(conversation.id)"><SearchIcon name="chat" /><span>{{ conversation.title || t('aiSearch.newConversation') }}</span></button>
          <div class="conversation-actions"><button class="icon-button" :disabled="busy || loadingArchive" :aria-label="t('aiSearch.rename')" @click="openAction('rename', conversation.id)"><SearchIcon name="edit" /></button><button class="icon-button" :disabled="busy || loadingArchive" :aria-label="t('aiSearch.delete')" @click="openAction('delete', conversation.id)"><SearchIcon name="trash" /></button></div>
        </div>
      </div>
      <div class="sidebar-footer"><SearchIcon name="shield" /><span>{{ t('aiSearch.localHistory') }}</span></div>
    </aside>
    <div class="history-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-controls="ai-search-history-panel" :aria-label="t('aiSearch.resizeHistory')" :title="t('aiSearch.resizeHistoryHint')" :aria-valuemin="220" :aria-valuemax="historyMaxWidth" :aria-valuenow="historyWidth" :aria-valuetext="`${historyWidth}px`" @pointerdown="startHistoryResize" @pointermove="moveHistoryResize" @pointerup="finishHistoryResize" @pointercancel="finishHistoryResize" @lostpointercapture="finishHistoryResize" @keydown="handleHistoryResizeKey" @dblclick="resetHistoryWidth"><span></span></div>
    <section id="ai-search-chat-panel" class="search-main" aria-labelledby="ai-chat-title">
      <div class="chat-panel-heading"><h2 id="ai-chat-title">{{ t('aiSearch.chatTitle') }}</h2><div class="chat-panel-actions"><button class="icon-button desktop-history-toggle" :aria-label="t(historyCollapsed ? 'aiSearch.toggleHistory' : 'aiSearch.closeHistory')" :title="t(historyCollapsed ? 'aiSearch.toggleHistory' : 'aiSearch.closeHistory')" :aria-expanded="!historyCollapsed" aria-controls="ai-search-history-panel" @click="historyCollapsed = !historyCollapsed"><SearchIcon name="menu" /></button><button class="icon-button history-toggle" :aria-label="t('aiSearch.toggleHistory')" :title="t('aiSearch.toggleHistory')" :aria-expanded="historyOpen" aria-controls="ai-search-history-panel" @click="historyOpen = !historyOpen"><SearchIcon name="menu" /></button></div></div>
      <div class="chat-panel-body">
      <div ref="messageViewport" class="message-viewport">
        <div v-if="!messages.length" class="search-welcome">
          <div class="welcome-symbol"><SearchIcon name="sparkles" /><span class="welcome-orbit orbit-one"></span><span class="welcome-orbit orbit-two"></span></div>
          <div class="welcome-eyebrow"><span class="status-dot" :class="{ loading: loadingCatalog }"></span>{{ loadingCatalog ? t(serverRetrieval ? 'aiSearch.loadingServerCatalog' : 'aiSearch.loadingCatalog') : catalogError && !catalogCount ? catalogErrorMessage || t('aiSearch.catalogError') : t('aiSearch.statusReady') }}<span v-if="catalogCount && !loadingCatalog" class="catalog-count">{{ catalogCount.toLocaleString() }}</span></div>
          <h2>{{ t('aiSearch.emptyTitle') }}</h2><p class="welcome-description">{{ t('aiSearch.emptySubtitle') }}</p>
          <div class="example-grid">
            <button v-for="example in examples" :key="example.kind" class="example-card" :class="`example-${example.kind}`" :disabled="busy || loadingArchive" @click="useExample(example.key, example.kind)"><span class="example-icon"><SearchIcon :name="example.icon" /></span><strong>{{ t(`aiSearch.${example.titleKey}`) }}</strong><p>{{ t(`aiSearch.${example.key}`) }}</p><span class="example-arrow">↗</span></button>
          </div>
          <p class="welcome-method"><SearchIcon name="shield" />{{ t('aiSearch.privacyHint') }}</p>
        </div>
        <div v-else class="message-thread">
          <article v-for="message in messages" :key="message.id" class="chat-message" :class="[`message-${message.role}`, { 'message-error': message.status === 'error' }]" :aria-label="message.role === 'assistant' ? t('aiSearch.assistant') : undefined">
            <div class="message-body">
              <div v-if="message.role === 'user'" class="message-byline"><strong>{{ t('aiSearch.you') }}</strong></div>
              <div v-if="message.status === 'pending'" class="thinking-state" role="status"><span class="thinking-dots"><i></i><i></i><i></i></span>{{ t('aiSearch.thinking') }}</div>
              <p v-if="message.content" class="message-text"><span>{{ message.content }}</span><ResponseDetails v-if="message.status === 'error' && message.rawResponse" :content="message.rawResponse" :detail-id="message.id" /></p>
              <ResourceResults v-if="message.cards?.length" :cards="message.cards" :result-id="message.id" />
            </div>
          </article>
        </div>
      </div>
      <footer class="composer-area">
        <div v-if="loadingArchive" class="inline-notice" role="status"><SearchIcon name="info" /><span>{{ t('aiSearch.loadingHistory') }}</span></div>
        <div v-if="archiveError" class="inline-notice warning-notice" role="status"><SearchIcon name="info" /><span>{{ archiveError }}</span></div>
        <div v-if="catalogError" class="inline-notice warning-notice" role="status"><SearchIcon name="info" /><span>{{ catalogErrorMessage || t('aiSearch.catalogError') }}</span><button :disabled="loadingCatalog" @click="reloadCatalog">{{ t('aiSearch.retryCatalog') }}</button></div>
        <div v-if="featuresUpdated" class="inline-notice feature-update-notice" role="status"><SearchIcon name="info" /><span>{{ t('aiSearch.featureSync.updated') }}</span><button @click="featuresUpdated = false">{{ t('aiSearch.featureSync.dismiss') }}</button></div>
        <div v-if="featureSync?.status === 'stale'" class="inline-notice warning-notice feature-stale-notice" role="status"><SearchIcon name="info" /><span>{{ t('aiSearch.featureSync.stale') }}</span><button :disabled="busy || loadingCatalog" @click="reloadCatalog">{{ t('aiSearch.retryCatalog') }}</button></div>
        <div v-if="featureMissing" class="inline-notice warning-notice feature-missing-notice" role="status"><SearchIcon name="info" /><span>{{ t('aiSearch.featureSync.missing') }}</span><button :disabled="busy || loadingCatalog" @click="reloadCatalog">{{ t('aiSearch.retryCatalog') }}</button></div>
        <div v-if="canRetrySearch" class="inline-notice warning-notice feature-retry-notice" role="status"><SearchIcon name="info" /><span>{{ t('aiSearch.featureSync.retryHint') }}</span><button :disabled="busy || loadingCatalog || loadingArchive" @click="retrySearch">{{ t('aiSearch.featureSync.retry') }}</button></div>
        <div v-if="mode === 'free' && (!freeAvailable || freeQuota?.remaining === 0)" class="inline-notice site-ai-notice" role="status">
          <SearchIcon name="info" /><span>{{ freeStatus === 'checking' ? t('aiSearch.checkingFree') : freeError || (freeQuota?.remaining === 0 ? t('aiSearch.errors.quota') : t('aiSearch.freeUnavailable')) }}</span>
          <div v-if="freeStatus !== 'checking'" class="site-ai-notice-actions">
            <button type="button" :disabled="busy || loadingArchive" @click="useOwnModel">{{ t(customReady ? 'aiSearch.useMyModel' : 'aiSearch.configureModel') }}</button>
            <button type="button" :disabled="busy || loadingArchive" @click="useBasicSearch">{{ t('aiSearch.modes.basic') }}</button>
          </div>
        </div>
        <div v-if="mode === 'free' && freeAvailable && resultLimit > freeResultLimit" class="inline-notice" role="status"><SearchIcon name="info" /><span>{{ t('aiSearch.freeResultLimitHint', { count: freeResultLimit }) }}</span></div>
        <div v-if="errorMessage" class="inline-notice error-notice" role="alert"><SearchIcon name="info" /><span>{{ errorMessage }}</span></div>
        <div class="search-controls">
          <div class="scope-pills" role="group" :aria-label="t('aiSearch.searchOptions')"><button v-for="item in scopes" :key="item" :class="{ selected: scope === item }" :aria-pressed="scope === item" :disabled="busy || loadingArchive" @click="scope = item">{{ t(`aiSearch.scopes.${item}`) }}</button></div><label v-if="scope === 'sound'" class="audio-toggle"><input v-model="includeEffectAudio" type="checkbox" :disabled="busy || loadingArchive" /><span>{{ t('aiSearch.includeEffectAudio') }}</span></label>
          <div class="result-limit-control"><span>{{ t('aiSearch.resultLimit') }}</span><ResultLimitSelect v-model="resultLimit" :disabled="busy || loadingArchive" /></div>
          <div v-if="!loadingCatalog && catalogCount > 0" class="catalog-status" role="status">
            <span class="retrieval-status">{{ t('aiSearch.retrievalStatus', { count: catalogCount.toLocaleString(), mode: t(`aiSearch.retrievalModes.${retrievalMode}`) }) }}</span>
            <span v-if="descriptionCoverage === 0" class="description-coverage-notice" :title="t('aiSearch.incompleteDescriptions')" tabindex="0"><SearchIcon name="info" /><span class="visually-hidden">{{ t('aiSearch.incompleteDescriptions') }}</span></span>
          </div>
        </div>
        <div class="composer-box" :class="{ 'is-busy': busy }">
          <label class="visually-hidden" for="asset-query">{{ t('aiSearch.placeholder') }}</label><textarea id="asset-query" ref="composer" v-model="draft" :placeholder="t('aiSearch.composerPlaceholder')" rows="1" maxlength="2000" :disabled="busy || loadingArchive" @keydown="handleComposerKey"></textarea>
            <div class="composer-actions" :class="{ 'has-free-model': mode === 'free' }">
              <button id="search-model-mode" class="model-trigger" :data-search-mode="mode" :disabled="busy || loadingArchive" :aria-label="currentModelTitle" :aria-description="currentModelSummary" aria-haspopup="dialog" aria-controls="ai-model-dialog" :aria-expanded="settingsOpen" :title="currentModelTitle" @click="openSettings"><span class="model-trigger-label">{{ currentModelLabel }}</span><span v-if="currentFreeRemaining" class="model-trigger-quota"> · {{ currentFreeRemaining }}</span><SearchIcon name="chevron" /></button>
              <button v-if="busy" class="send-button stop-button" :aria-label="t('aiSearch.stop')" :title="t('aiSearch.stop')" @click="stop"><span class="stop-symbol"></span></button>
              <button v-else class="send-button" :disabled="!canSend" :aria-label="t('aiSearch.send')" :title="t('aiSearch.send')" @click="submitMessage"><SearchIcon name="send-up" /></button>
            </div>
        </div>
      </footer>
      </div>
    </section>
    <Teleport to="body">
      <dialog id="ai-model-dialog" ref="settingsDialog" class="ai-search-dialog model-dialog" aria-labelledby="ai-settings-title" @cancel="closeSettings" @pointerdown.capture="trackDialogPointerDown" @pointercancel="resetDialogPointerDown" @click="handleDialogBackdrop($event, closeSettings)">
        <form @submit.prevent="persistSettings"><div class="dialog-heading"><div><h2 id="ai-settings-title">{{ t('aiSearch.configTitle') }}</h2><p>{{ t('aiSearch.configSubtitle') }}</p></div><button type="button" class="icon-button" :aria-label="t('aiSearch.dismiss')" @click="closeSettings"><SearchIcon name="close" /></button></div>
          <div class="model-mode-options" role="group" :aria-label="t('aiSearch.selectModel')"><button v-for="option in modelModes" :key="option.mode" type="button" :data-search-mode-option="option.mode" :aria-pressed="configMode === option.mode" @click="selectConfigMode(option.mode)"><SearchIcon :name="option.icon" /><span>{{ t(`aiSearch.modes.${option.mode}`) }}</span></button></div>
          <div v-if="configMode === 'free'" class="free-model-panel"><div class="free-model-title"><SearchIcon name="sparkles" /><strong>{{ t('aiSearch.modes.free') }}</strong><span class="free-status-pill" :class="{ available: freeAvailable }">{{ freeAvailable ? t('aiSearch.available') : freeStatus === 'checking' ? t('aiSearch.checkingFree') : t('aiSearch.unavailableBadge') }}</span></div><p v-if="!freeAvailable">{{ freeError || t('aiSearch.freeUnavailable') }}</p><div class="free-panel-footer"><span v-if="freeQuota">{{ t('aiSearch.freeQuota', { remaining: freeQuota.remaining, limit: freeQuota.limit }) }}</span><button type="button" :disabled="freeStatus === 'checking'" @click="refreshFreeStatus">{{ t('aiSearch.refreshStatus') }}</button></div></div>
          <div v-else-if="configMode === 'basic'" class="basic-model-panel"><SearchIcon name="search" /><p>{{ t('aiSearch.basicHint') }}</p></div>
          <template v-else>
          <div class="custom-model-heading"><h3>{{ t('aiSearch.modes.custom') }}</h3><span v-if="customReady">{{ t('aiSearch.customConfigured') }}</span></div>
          <label class="config-field"><span>{{ t('aiSearch.apiBaseUrl') }}</span><input v-model="configDraft.baseUrl" type="url" placeholder="https://api.deepseek.com/v1" required autocomplete="off" /><small>{{ t('aiSearch.apiBaseUrlHint') }}</small></label>
          <label class="config-field"><span>{{ t('aiSearch.modelName') }}</span><input v-model="configDraft.model" type="text" placeholder="qwen-flash" required autocomplete="off" /></label>
          <label class="config-field"><span>{{ t('aiSearch.apiKey') }}</span><div class="secret-field"><input v-model="configDraft.apiKey" :type="keyVisible ? 'text' : 'password'" placeholder="sk-…" autocomplete="off" spellcheck="false" /><button type="button" class="icon-button" :aria-label="t(keyVisible ? 'aiSearch.hideKey' : 'aiSearch.showKey')" :aria-pressed="keyVisible" @click="keyVisible = !keyVisible"><SearchIcon name="eye" /></button></div><small>{{ t('aiSearch.apiKeyHint') }}</small></label>
          <label class="remember-key"><input v-model="configDraft.rememberKey" type="checkbox" /><span>{{ t('aiSearch.rememberKey') }}<small>{{ t('aiSearch.rememberKeyWarning') }}</small></span></label><p class="config-help">{{ t('aiSearch.configHelp') }}</p><p v-if="settingsError" class="settings-error" role="alert">{{ settingsError }}</p>
          </template>
          <div class="dialog-actions"><button type="button" class="secondary-button" @click="closeSettings">{{ t('aiSearch.cancel') }}</button><button type="submit" class="primary-button" :disabled="busy || loadingArchive">{{ t(configMode === 'custom' ? 'aiSearch.saveAndUseModel' : 'aiSearch.useModel') }}</button></div>
        </form>
      </dialog>
      <dialog ref="actionDialog" class="ai-search-dialog action-dialog" aria-labelledby="ai-action-title" @cancel="closeAction" @pointerdown.capture="trackDialogPointerDown" @pointercancel="resetDialogPointerDown" @click="handleDialogBackdrop($event, closeAction)"><form @submit.prevent="performAction"><div class="dialog-heading"><h2 id="ai-action-title">{{ t(`aiSearch.${actionKind}`) }}</h2><button type="button" class="icon-button" :aria-label="t('aiSearch.dismiss')" @click="closeAction"><SearchIcon name="close" /></button></div><label v-if="actionKind === 'rename'" class="config-field"><span>{{ t('aiSearch.conversationTitle') }}</span><input v-model="renameDraft" maxlength="80" required /></label><p v-else class="action-description">{{ t('aiSearch.confirmDelete') }}</p><div class="dialog-actions"><button type="button" class="secondary-button" @click="closeAction">{{ t('aiSearch.cancel') }}</button><button type="submit" class="primary-button" :class="{ 'danger-button': actionKind === 'delete' }">{{ t('aiSearch.confirm') }}</button></div></form></dialog>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchIcon from './components/SearchIcon.vue'
import ResourceResults from './components/ResourceResults.vue'
import ResponseDetails from './components/ResponseDetails.vue'
import { useAISearch } from './useAISearch'
import ResultLimitSelect from './components/ResultLimitSelect.vue'
import { useHistoryResize } from './useHistoryResize'
import type { SearchMode } from './types'

const { t } = useI18n({ useScope: 'global' })
const { conversations, activeConversationId, messages, busy, loadingCatalog, loadingArchive, archiveError, catalogError, catalogErrorMessage, catalogCount, descriptionCoverage, serverRetrieval, retrievalMode, featureSync, featuresUpdated, featureMissing, canRetrySearch, retrySearch, mode, scope, includeEffectAudio, resultLimit, freeResultLimit, freeAvailable, freeStatus, freeQuota, freeError, modelConfig, errorMessage, createConversation, selectConversation, renameConversation, deleteConversation, send, stop, saveConfig, refreshFreeStatus, reloadCatalog } = useAISearch()
const scopes = ['all', 'sound', 'effect', 'bgm'] as const
// Temporarily hide the BGM suggestion on the new-conversation welcome screen.
const examples = [{ kind: 'sound', icon: 'sound', key: 'exampleSound', titleKey: 'exampleSoundTitle' }, { kind: 'effect', icon: 'effect', key: 'exampleEffect', titleKey: 'exampleEffectTitle' }] as const
const draft = ref('')
const historyOpen = ref(false)
const historyCollapsed = ref(false)
const workspace = ref<HTMLElement>()
const { historyWidth, historyMaxWidth, resizingHistory, startHistoryResize, moveHistoryResize, finishHistoryResize, handleHistoryResizeKey, resetHistoryWidth } = useHistoryResize(workspace, historyCollapsed)
const composer = ref<HTMLTextAreaElement>()
const messageViewport = ref<HTMLElement>()
const settingsDialog = ref<HTMLDialogElement>()
const actionDialog = ref<HTMLDialogElement>()
const dialogBackdropStarts = new WeakSet<HTMLDialogElement>()
const keyVisible = ref(false)
const settingsOpen = ref(false)
const settingsError = ref('')
const configMode = ref<SearchMode>(mode.value)
const modelModes = [{ mode: 'free', icon: 'sparkles' }, { mode: 'custom', icon: 'settings' }, { mode: 'basic', icon: 'search' }] as const
const configDraft = reactive({ baseUrl: '', model: '', apiKey: '', rememberKey: false })
const currentModelLabel = computed(() => mode.value === 'free' ? t('aiSearch.freeModelLabel') : mode.value === 'custom' ? modelConfig.value.model || t('aiSearch.modes.custom') : t('aiSearch.modes.basic'))
const currentFreeRemaining = computed(() => mode.value === 'free' && freeQuota.value ? t('aiSearch.freeQuotaRemaining', { remaining: freeQuota.value.remaining }) : '')
const currentModelSummary = computed(() => [currentModelLabel.value, currentFreeRemaining.value].filter(Boolean).join(' · '))
const currentModelTitle = computed(() => [t('aiSearch.modelSettings'), currentModelSummary.value].join(' · '))
const customReady = computed(() => !!(modelConfig.value.baseUrl.trim() && modelConfig.value.model.trim() && modelConfig.value.apiKey.trim()))
const canSend = computed(() => !!draft.value.trim() && !busy.value && !loadingCatalog.value && !loadingArchive.value && (mode.value === 'basic' || (mode.value === 'free' && freeAvailable.value && (!freeQuota.value || freeQuota.value.remaining > 0)) || (mode.value === 'custom' && customReady.value)))
const actionKind = ref<'rename' | 'delete'>('rename')
const actionConversationId = ref('')
const renameDraft = ref('')
let previousFocus: HTMLElement | null = null
let composerObserver: ResizeObserver | undefined

function resizeComposer() {
  const element = composer.value
  if (!element) return
  element.style.height = 'auto'
  const styles = getComputedStyle(element)
  const maxHeight = parseFloat(styles.maxHeight) || 112
  const minHeight = parseFloat(styles.minHeight) || 24
  const contentHeight = element.value ? element.scrollHeight : minHeight
  element.style.height = `${Math.min(contentHeight, maxHeight)}px`
  element.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
}
watch(draft, resizeComposer, { flush: 'post' })
onMounted(() => {
  resizeComposer()
  if (!composer.value) return
  let previousWidth = 0
  composerObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width
    if (width && width !== previousWidth) {
      previousWidth = width
      resizeComposer()
    }
  })
  composerObserver.observe(composer.value)
})

async function submitMessage() {
  if (!canSend.value) return
  const question = draft.value.trim()
  draft.value = ''
  await send(question)
  await nextTick()
  composer.value?.focus()
}
function handleComposerKey(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submitMessage() } }
async function useExample(key: string, kind: 'sound' | 'effect' | 'bgm') { scope.value = kind; draft.value = t(`aiSearch.${key}`); await nextTick(); composer.value?.focus() }
async function startConversation() { createConversation(); draft.value = ''; historyOpen.value = false; await nextTick(); composer.value?.focus() }
function openConversation(id: string) { selectConversation(id); draft.value = ''; historyOpen.value = false }
async function showDialog(dialog: HTMLDialogElement | undefined) { if (dialog) dialogBackdropStarts.delete(dialog); previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; await nextTick(); dialog?.showModal() }
function restoreFocus() { const target = previousFocus; previousFocus = null; void nextTick(() => { if (target?.isConnected) target.focus(); else composer.value?.focus() }) }
async function openSettingsForMode(value: SearchMode) { Object.assign(configDraft, modelConfig.value); configMode.value = value; settingsError.value = ''; keyVisible.value = false; await showDialog(settingsDialog.value); settingsOpen.value = true }
function openSettings() { return openSettingsForMode(mode.value) }
async function useOwnModel() {
  if (busy.value || loadingArchive.value) return
  if (!customReady.value) { await openSettingsForMode('custom'); return }
  mode.value = 'custom'
  errorMessage.value = ''
  await nextTick()
  composer.value?.focus()
}
async function useBasicSearch() {
  if (busy.value || loadingArchive.value) return
  mode.value = 'basic'
  errorMessage.value = ''
  await nextTick()
  composer.value?.focus()
}
function closeSettings() { if (settingsDialog.value) dialogBackdropStarts.delete(settingsDialog.value); settingsDialog.value?.close(); settingsOpen.value = false; configDraft.apiKey = ''; keyVisible.value = false; restoreFocus() }
function selectConfigMode(value: SearchMode) { configMode.value = value; settingsError.value = ''; keyVisible.value = false }
async function persistSettings() { if (configMode.value !== 'custom') { mode.value = configMode.value; errorMessage.value = ''; closeSettings() } else if (await saveConfig({ ...configDraft })) closeSettings(); else settingsError.value = errorMessage.value || t('aiSearch.invalidConfig') }
async function openAction(kind: 'rename' | 'delete', id = '') { actionKind.value = kind; actionConversationId.value = id; renameDraft.value = conversations.value.find(item => item.id === id)?.title || ''; await showDialog(actionDialog.value) }
function closeAction() { if (actionDialog.value) dialogBackdropStarts.delete(actionDialog.value); actionDialog.value?.close(); restoreFocus() }
function performAction() { if (actionKind.value === 'rename') renameConversation(actionConversationId.value, renameDraft.value.trim()); else deleteConversation(actionConversationId.value); closeAction() }
function isDialogBackdrop(event: MouseEvent) {
  if (event.target !== event.currentTarget) return false
  const bounds = (event.currentTarget as HTMLDialogElement).getBoundingClientRect()
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
}
function resetDialogPointerDown(event: PointerEvent) { dialogBackdropStarts.delete(event.currentTarget as HTMLDialogElement) }
function trackDialogPointerDown(event: PointerEvent) {
  resetDialogPointerDown(event)
  if (event.button === 0 && event.isPrimary && isDialogBackdrop(event)) dialogBackdropStarts.add(event.currentTarget as HTMLDialogElement)
}
function handleDialogBackdrop(event: MouseEvent, close: () => void) {
  const dialog = event.currentTarget as HTMLDialogElement
  const startedOnBackdrop = dialogBackdropStarts.has(dialog)
  dialogBackdropStarts.delete(dialog)
  // A text selection dragged outside can send its click to the dialog itself.
  if (startedOnBackdrop && event.button === 0 && isDialogBackdrop(event)) close()
}
watch(() => [messages.value.length, busy.value, messages.value[messages.value.length - 1]?.status], async () => { await nextTick(); const viewport = messageViewport.value; if (viewport) viewport.scrollTop = viewport.scrollHeight })
watch(activeConversationId, async () => { await nextTick(); if (messageViewport.value) messageViewport.value.scrollTop = messageViewport.value.scrollHeight })
onBeforeUnmount(() => { composerObserver?.disconnect(); settingsDialog.value?.close(); actionDialog.value?.close() })
</script>

<style src="./AISearch.css"></style>
