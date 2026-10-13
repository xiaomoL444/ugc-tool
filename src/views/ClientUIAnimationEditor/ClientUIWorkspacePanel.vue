<template>
  <div v-if="open" class="workspace-backdrop" @pointerdown.stop @click.self="requestClose">
    <section
      ref="dialogElement"
      class="workspace-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-ui-workspace-title"
      :aria-busy="busy"
      tabindex="-1"
      @keydown.esc.stop.prevent="requestClose"
      @keydown.tab="trapFocus"
    >
      <header class="dialog-heading">
        <span class="heading-icon"><EditorIcon name="folder" :size="22" /></span>
        <div class="heading-copy">
          <span class="eyebrow">{{ kind === 'particles' ? t('clientUIAnimationEditor.ui.workspace.clientUiEffects') : t('clientUIAnimationEditor.ui.workspace.uiAnimationCategory') }}</span>
          <h2 id="client-ui-workspace-title">{{ t('clientUIAnimationEditor.ui.workspace.documentsHeading') }}</h2>
        </div>
        <button class="close-button" type="button" :disabled="busy" :aria-label="t('clientUIAnimationEditor.ui.workspace.closePanel')" :title="t('clientUIAnimationEditor.ui.actions.close')" @click="requestClose">×</button>
      </header>

      <div class="workspace-content">
        <aside class="workspace-sidebar" :aria-label="t('clientUIAnimationEditor.ui.workspace.managementTitle')">
          <div class="section-heading"><h3>{{ t('clientUIAnimationEditor.ui.workspace.title') }}<span>{{ workspaces.length }}</span></h3></div>
          <button class="action-button new-workspace" type="button" :disabled="busy" @click="emit('create-workspace')"><EditorIcon name="plus" :size="15" />{{ t('clientUIAnimationEditor.ui.workspace.create') }}</button>
          <div class="name-list workspace-list" role="group" :aria-label="t('clientUIAnimationEditor.ui.workspace.list')">
            <button
              v-for="name in workspaces"
              :key="name"
              class="name-row"
              :class="{ selected: name === workspace }"
              :aria-pressed="name === workspace"
              :disabled="busy"
              :title="name"
              type="button"
              @click="emit('select-workspace', name)"
            >
              <EditorIcon name="folder" :size="17" /><span class="row-name">{{ name }}</span><span v-if="name === workspace" class="selected-dot" aria-hidden="true"></span>
            </button>
            <div v-if="!workspaces.length" class="empty-list"><EditorIcon name="folder" :size="26" /><p>{{ t('clientUIAnimationEditor.ui.workspace.empty') }}</p><small>{{ kind === 'particles' ? t('clientUIAnimationEditor.ui.workspace.createUiEffectsHint') : t('clientUIAnimationEditor.ui.workspace.newWorkspaceHint') }}</small></div>
          </div>
          <div class="list-actions">
            <button type="button" :disabled="busy || !workspace" @click="emit('rename-workspace')">{{ t('clientUIAnimationEditor.ui.workspace.rename') }}</button>
            <button class="danger-action" type="button" :disabled="busy || !workspace" @click="emit('delete-workspace')"><EditorIcon name="trash" :size="14" />{{ t('clientUIAnimationEditor.ui.workspace.deleteWorkspace') }}</button>
          </div>
        </aside>

        <main class="document-pane" :aria-label="t('clientUIAnimationEditor.ui.workspace.manageEditorFiles')">
          <div class="section-heading document-heading">
            <div><h3>{{ t('clientUIAnimationEditor.ui.workspace.editorFile') }}<span>{{ documents.length }}</span></h3><p :title="workspace">{{ workspace || t('clientUIAnimationEditor.ui.workspace.createOrSelectRequired') }}</p></div>
          </div>
          <div class="document-tools" role="group" :aria-label="t('clientUIAnimationEditor.ui.workspace.createAndImportFiles')">
            <button class="action-button primary-action" type="button" :disabled="busy || !workspace" @click="emit('create-document')"><EditorIcon name="plus" :size="15" />{{ t('clientUIAnimationEditor.ui.workspace.createDocument') }}</button>
            <button v-if="kind !== 'particles'" class="action-button" type="button" :disabled="busy || !workspace" @click="emit('import-gia')"><EditorIcon name="import" :size="15" />{{ t('clientUIAnimationEditor.ui.importMenu.gia') }}</button>
            <button class="action-button" type="button" :disabled="busy || !workspace" @click="emit('import-json')">{{ t('clientUIAnimationEditor.ui.importMenu.json') }}</button>
          </div>
          <div class="name-list document-list" role="group" :aria-label="t('clientUIAnimationEditor.ui.workspace.documentList')">
            <button
              v-for="name in documents"
              :key="name"
              class="name-row document-row"
              :class="{ selected: name === document }"
              :aria-pressed="name === document"
              :disabled="busy"
              :title="name"
              type="button"
              @click="emit('select-document', name)"
            >
              <span class="document-icon"><EditorIcon name="timeline" :size="20" /></span>
              <span class="document-copy"><span class="row-name">{{ name }}</span><small>{{ kind === 'particles' ? t('clientUIAnimationEditor.ui.workspace.uiParticleFileType') : t('clientUIAnimationEditor.ui.workspace.animationFileType') }}</small></span>
              <span v-if="name === document" class="current-label">{{ t('clientUIAnimationEditor.ui.workspace.currentEditorFile') }}</span>
            </button>
            <div v-if="!documents.length" class="empty-list document-empty"><EditorIcon name="timeline" :size="32" /><p>{{ workspace ? t('clientUIAnimationEditor.ui.workspace.noEditorFiles') : t('clientUIAnimationEditor.ui.workspace.selectWorkspaceHint') }}</p><small>{{ kind === 'particles' ? (workspace ? t('clientUIAnimationEditor.ui.workspace.createEffectHint') : t('clientUIAnimationEditor.ui.workspace.multipleParticleFilesHint')) : (workspace ? t('clientUIAnimationEditor.ui.workspace.blankCanvasOrImportHint') : t('clientUIAnimationEditor.ui.workspace.multiDocumentHint')) }}</small></div>
          </div>
          <div class="list-actions document-actions">
            <span class="selected-document" :title="document">{{ document || t('clientUIAnimationEditor.ui.workspace.documentNotSelected') }}</span>
            <button type="button" :disabled="busy || !document" @click="emit('rename-document')">{{ t('clientUIAnimationEditor.ui.workspace.rename') }}</button>
            <button class="danger-action" type="button" :disabled="busy || !document" @click="emit('delete-document')"><EditorIcon name="trash" :size="14" />{{ t('clientUIAnimationEditor.ui.workspace.deleteFile') }}</button>
          </div>
        </main>
      </div>

      <div v-if="error" class="error-message" role="alert"><span>{{ error }}</span><button type="button" :disabled="busy" @click="emit('retry')">{{ t('clientUIAnimationEditor.ui.workspace.retrySave') }}</button></div>
      <footer class="dialog-footer">
        <span class="save-status" :class="{ saving: busy, failed: !!error }" role="status" aria-live="polite"><span class="status-dot" aria-hidden="true"></span>{{ status || (busy ? t('clientUIAnimationEditor.ui.common.processing') : t('clientUIAnimationEditor.ui.workspace.archiveReady')) }}</span>
        <span class="import-hint">{{ kind === 'particles' ? t('clientUIAnimationEditor.ui.workspace.effectJsonImportHint') : t('clientUIAnimationEditor.ui.workspace.giaCreatesNewFileHint') }}</span>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { t } from '../../i18n';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import EditorIcon from './EditorIcon.vue'

const props = defineProps<{
  kind?: "animation" | "particles"
  open: boolean
  busy: boolean
  workspaces: string[]
  documents: string[]
  workspace: string
  document: string
  status: string
  error: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'select-workspace', name: string): void
  (event: 'create-workspace'): void
  (event: 'rename-workspace'): void
  (event: 'delete-workspace'): void
  (event: 'select-document', name: string): void
  (event: 'create-document'): void
  (event: 'rename-document'): void
  (event: 'delete-document'): void
  (event: 'import-gia'): void
  (event: 'import-json'): void
  (event: 'retry'): void
}>()

const dialogElement = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null

function requestClose() {
  if (!props.busy) emit('close')
}

function restoreFocus() {
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = null
}

function trapFocus(event: KeyboardEvent) {
  const dialog = dialogElement.value
  if (!dialog) return
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) {
    event.preventDefault()
    dialog.focus({ preventScroll: true })
    return
  }
  const active = window.document.activeElement
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || active === dialog)) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (!open) {
    restoreFocus()
    return
  }
  previousFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
  await nextTick()
  if (props.open) dialogElement.value?.focus({ preventScroll: true })
}, { immediate: true })

onBeforeUnmount(restoreFocus)
</script>

<style scoped>
.workspace-backdrop { position: fixed; inset: 0; z-index: 1400; display: flex; align-items: center; justify-content: center; padding: 24px; background: #0a0d14b5; backdrop-filter: blur(5px); }
.workspace-dialog { display: flex; flex-direction: column; width: min(920px, 100%); max-height: calc(100vh - 48px); max-height: calc(100dvh - 48px); min-height: 0; overflow: hidden; color: #d9dfeb; font-family: inherit; font-size: 13px; line-height: 1.5; background: #1d222c; border: 1px solid #424b60; border-radius: 12px; box-shadow: 0 26px 100px #0009; outline: none; }
.workspace-dialog * { box-sizing: border-box; }
.workspace-dialog button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin: 0; border: 0; font: inherit; cursor: pointer; color: inherit; background: transparent; transition: background .14s, border-color .14s, color .14s; }
.workspace-dialog button:disabled { cursor: not-allowed; opacity: .4; }
.workspace-dialog button:focus-visible { outline: 2px solid #8ba7ff; outline-offset: -2px; }
.dialog-heading { display: flex; align-items: center; flex: 0 0 auto; gap: 12px; padding: 20px 22px; border-bottom: 1px solid #343b4b; }
.heading-icon { display: grid; place-items: center; width: 42px; height: 42px; flex: 0 0 auto; color: #9db4ff; background: #38486970; border: 1px solid #465c85; border-radius: 10px; }
.heading-copy { min-width: 0; }
.eyebrow { color: #8996ac; font-size: 11px; letter-spacing: .07em; }
.dialog-heading h2 { margin: 1px 0 0; color: #f0f3f9; font-size: 17px; font-weight: 600; }
.workspace-dialog .close-button { align-self: flex-start; width: 30px; height: 30px; margin: -2px -6px 0 auto; border-radius: 6px; color: #a8b4c8; font-size: 25px; line-height: 1; }
.workspace-dialog .close-button:not(:disabled):hover { background: #363e4f; color: #fff; }
.workspace-content { display: grid; grid-template-columns: 245px minmax(0, 1fr); min-height: 250px; height: 410px; overflow: hidden; }
.workspace-sidebar, .document-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.workspace-sidebar { padding: 19px 12px 0; background: #191d26; border-right: 1px solid #343b4b; }
.section-heading { display: flex; align-items: center; justify-content: space-between; min-width: 0; padding: 0 8px; }
.section-heading h3 { margin: 0; color: #dfe5f1; font-size: 13px; font-weight: 600; }
.section-heading h3 span { margin-left: 5px; font-size: 11px; font-weight: 400; color: #8b9bb4; }
.workspace-dialog .action-button { min-height: 32px; padding: 6px 10px; border: 1px solid #455069; border-radius: 6px; white-space: nowrap; background: #2b3342; color: #cdd8ec; font-size: 12px; }
.workspace-dialog .action-button:not(:disabled):hover { background: #364258; border-color: #677fa7; color: #fff; }
.workspace-dialog .primary-action { background: #4a6dde; border-color: #6c89ea; color: #fff; }
.workspace-dialog .primary-action:not(:disabled):hover { background: #597beb; border-color: #8ba4fb; }
.workspace-dialog .new-workspace { justify-content: flex-start; margin: 12px 5px 10px; }
.name-list { flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: #465167 transparent; }
.name-list::-webkit-scrollbar { width: 6px; }
.name-list::-webkit-scrollbar-thumb { background: #465167; border-radius: 3px; }
.workspace-dialog .name-row { display: flex; justify-content: flex-start; width: 100%; min-width: 0; gap: 9px; padding: 10px; margin: 0 0 4px; border: 1px solid transparent; border-radius: 6px; text-align: left; color: #a9b7cc; }
.workspace-dialog .name-row:not(:disabled):hover { background: #2c3546; color: #e1e8f6; }
.workspace-dialog .name-row.selected { background: #30436d; border-color: #4a649b; color: #e1eaff; }
.row-name { display: block; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.workspace-list .row-name { flex: 1; }
.selected-dot { width: 5px; height: 5px; flex: 0 0 auto; background: #a0b6ff; border-radius: 50%; }
.list-actions { display: flex; align-items: center; flex: 0 0 auto; gap: 6px; min-height: 53px; margin-top: 10px; padding: 8px 1px; border-top: 1px solid #343b4b; }
.list-actions button { padding: 5px 7px; border-radius: 4px; font-size: 11px; white-space: nowrap; color: #b4c0d6; }
.list-actions button:not(:disabled):hover { background: #364054; color: #f0f4fd; }
.workspace-dialog .danger-action:not(:disabled):hover { background: #5e3444; color: #ffbdc8; }
.workspace-sidebar .list-actions { justify-content: space-between; }
.document-pane { padding: 19px 20px 0; }
.document-heading { padding: 0; }
.document-heading > div { min-width: 0; }
.document-heading p { overflow: hidden; margin: 3px 0 0; color: #8899b5; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.document-tools { display: flex; flex-wrap: wrap; flex: 0 0 auto; gap: 7px; margin: 15px 0 14px; }
.workspace-dialog .document-row { gap: 12px; padding: 10px; margin-bottom: 7px; background: #242b38; border-color: #323d51; }
.workspace-dialog .document-row.selected { background: #30436d; border-color: #6283ce; }
.document-icon { display: grid; place-items: center; width: 35px; height: 38px; flex: 0 0 auto; color: #a0b7df; background: #1a253c; border-radius: 5px; }
.document-copy { display: block; flex: 1; min-width: 0; }
.document-copy small { display: block; margin-top: 2px; color: #91a1bb; font-size: 10px; }
.current-label { flex: 0 0 auto; padding: 2px 6px; color: #b5c9ff; font-size: 10px; background: #4b68a04d; border-radius: 4px; white-space: nowrap; }
.document-actions { margin-top: 8px; }
.selected-document { flex: 1; min-width: 0; overflow: hidden; color: #7e8fa9; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.empty-list { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 145px; padding: 18px 13px; text-align: center; color: #61728d; }
.empty-list p { margin: 3px 0 0; font-size: 12px; color: #a1afc5; }
.empty-list small { max-width: 265px; color: #788ba7; font-size: 11px; line-height: 1.7; }
.document-empty { min-height: 190px; height: 100%; border: 1px dashed #39455c; border-radius: 7px; }
.error-message { display: flex; align-items: center; flex: 0 0 auto; gap: 14px; padding: 11px 20px; background: #492c39; border-top: 1px solid #6e4253; color: #ffbdc9; font-size: 12px; }
.error-message > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.error-message button { flex: 0 0 auto; padding: 5px 9px; border: 1px solid #a7687d; border-radius: 5px; white-space: nowrap; }
.error-message button:not(:disabled):hover { background: #6d3d50; }
.dialog-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; flex: 0 0 auto; gap: 7px 16px; padding: 13px 21px; background: #1b2029; border-top: 1px solid #343b4b; font-size: 11px; }
.save-status { display: inline-flex; align-items: center; gap: 7px; color: #a0b2ce; }
.status-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: #7cb9a5; }
.saving .status-dot { background: #9ab4ff; animation: workspace-saving-pulse 1s ease-in-out infinite alternate; }
.failed .status-dot { background: #fa98ad; }
.import-hint { color: #7788a3; }
@keyframes workspace-saving-pulse { to { opacity: .3; } }
@media (max-width: 680px) {
  .workspace-backdrop { padding: 12px; }
  .workspace-dialog { max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); }
  .dialog-heading { padding: 16px; }
  .workspace-content { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(155px, .7fr) minmax(240px, 1fr); height: 580px; min-height: 310px; }
  .workspace-sidebar { position: relative; padding: 13px 15px 0; border-right: 0; border-bottom: 1px solid #343b4b; }
  .workspace-sidebar .section-heading { padding: 0; min-height: 30px; }
  .workspace-dialog .new-workspace { position: absolute; top: 11px; right: 15px; min-height: 28px; margin: 0; padding: 3px 7px; }
  .workspace-list { margin-top: 8px; }
  .workspace-sidebar .list-actions { min-height: 39px; margin-top: 5px; padding: 4px 0; justify-content: flex-end; }
  .document-pane { padding: 13px 15px 0; }
  .document-tools { margin: 10px 0; }
  .document-actions { min-height: 43px; }
  .dialog-footer { padding: 11px 16px; }
  .empty-list { min-height: 80px; padding: 9px; }
  .document-empty { min-height: 120px; }
}
@media (prefers-reduced-motion: reduce) { .saving .status-dot { animation: none; } }
</style>
