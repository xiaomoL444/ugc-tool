<template>
  <div class="timeline-import-backdrop" @pointerdown.stop @click.self="close" @keydown.stop @keyup.stop @keypress.stop>
    <form
      ref="dialogElement"
      class="timeline-import-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="timeline-data-import-title"
      aria-describedby="timeline-data-import-description"
      :aria-busy="readingFile"
      tabindex="-1"
      @submit.prevent="confirm"
      @keydown.esc.stop.prevent="close"
      @keydown.tab="trapFocus"
    >
      <header>
        <h2 id="timeline-data-import-title">导入 Timeline Data</h2>
        <p id="timeline-data-import-description">按所选根控件的相对路径匹配现有控件。Data 不包含完整控件；导入不会创建控件，也不会执行 Lua。</p>
      </header>

      <div class="source-heading">
        <label for="timeline-data-import-source">Timeline Data 源码</label>
        <button type="button" @click="fileInput?.click()">选择 Data 文件</button>
        <input ref="fileInput" hidden type="file" accept=".lua,.txt" aria-label="选择 Timeline Data 文件" @change="readFile" />
      </div>
      <textarea
        id="timeline-data-import-source"
        ref="sourceInput"
        :value="sourceText"
        :maxlength="MAX_SOURCE_BYTES"
        aria-label="Timeline Data 源码"
        aria-describedby="timeline-data-import-source-help"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="在此粘贴 Timeline Data，或选择 .lua / .txt 文件"
        @input="updateSource"
      />
      <p id="timeline-data-import-source-help" class="field-help">支持 .lua / .txt 文件，最大 2 MiB。所有内容仅作为数据解析。</p>
      <p v-if="readingFile" class="read-status" role="status">正在读取文件…</p>
      <p v-if="fileError" class="notice error-notice" role="alert">{{ fileError }}</p>

      <label class="root-field">
        <span>导入根控件</span>
        <select :value="rootId" aria-label="导入根控件" @change="updateRoot">
          <option disabled value="">请选择根控件</option>
          <option v-for="root in roots" :key="root.id" :value="root.id">{{ root.label }}</option>
        </select>
      </label>

      <fieldset class="mode-field">
        <legend>导入方式</legend>
        <label>
          <input type="radio" name="timeline-data-import-mode" value="append" :checked="mode === 'append'" @change="emit('update:mode', 'append')" />
          <span>追加</span>
        </label>
        <label>
          <input type="radio" name="timeline-data-import-mode" value="replace" :checked="mode === 'replace'" @change="emit('update:mode', 'replace')" />
          <span>替换所选根及其子级动画</span>
        </label>
      </fieldset>
      <div v-if="mode === 'replace'" class="notice replace-notice" role="status">
        <strong>替换动画</strong>
        <p v-if="preview">将替换所选根控件及其子级的 {{ preview.replacedCount }} 条关键帧轨道，不影响其他控件的动画。</p>
        <p v-else>将替换所选根控件及其子级的动画，不影响其他控件。输入 Data 后可查看待替换的轨道数量。</p>
      </div>

      <section class="preview-section" aria-label="导入预览" aria-live="polite">
        <h3>导入预览</h3>
        <p v-if="!preview" class="preview-empty">请粘贴 Timeline Data 或选择 Data 文件以查看预览。</p>
        <template v-else>
          <div v-if="preview.errors.length" class="notice error-notice">
            <strong>无法导入，请修正以下问题</strong>
            <ul><li v-for="(error, index) in preview.errors" :key="index">{{ error }}</li></ul>
            <p>所有问题修正后才能导入，不会跳过错误内容进行部分导入。</p>
          </div>
          <template v-else>
            <dl class="preview-summary">
              <div><dt>待导入</dt><dd>{{ preview.importedCount }} 条关键帧轨道</dd></div>
              <div><dt>Schema</dt><dd>{{ preview.schema || '未识别' }}</dd></div>
              <div><dt>导入后总时长</dt><dd>{{ formatDuration(preview.duration) }} 秒</dd></div>
            </dl>
            <p v-if="preview.importedCount === 0" class="notice error-notice">Data 中没有可导入的关键帧轨道，不能使用空数据清空动画。</p>
          </template>
          <div v-if="preview.warnings.length" class="notice warning-notice">
            <strong>请留意</strong>
            <ul><li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li></ul>
          </div>
        </template>
      </section>

      <footer>
        <button type="button" @click="close">取消</button>
        <button class="primary-action" :class="{ 'replace-action': mode === 'replace' }" type="submit" :disabled="!canConfirm">确认导入</button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  sourceText: string
  rootId: string
  roots: Array<{ id: string; label: string }>
  mode: 'append' | 'replace'
  preview: {
    schema: string | null
    importedCount: number
    replacedCount: number
    duration: number
    errors: string[]
    warnings: string[]
  } | null
}>()
const emit = defineEmits<{
  (event: 'update:sourceText', value: string): void
  (event: 'update:rootId', value: string): void
  (event: 'update:mode', value: 'append' | 'replace'): void
  (event: 'confirm'): void
  (event: 'close'): void
}>()

const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const dialogElement = ref<HTMLFormElement | null>(null)
const sourceInput = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const readingFile = ref(false)
const fileError = ref('')
let readToken = 0
let unmounted = false
let submissionPending = false
let previousFocus: HTMLElement | null = null

const canConfirm = computed(() => !readingFile.value
  && !fileError.value
  && props.sourceText.trim().length > 0
  && props.roots.some(root => root.id === props.rootId)
  && props.preview !== null
  && props.preview.errors.length === 0
  && props.preview.importedCount > 0)

function invalidateFileRead() {
  readToken += 1
  readingFile.value = false
}

function updateSource(event: Event) {
  invalidateFileRead()
  fileError.value = ''
  emit('update:sourceText', (event.target as HTMLTextAreaElement).value)
}

function updateRoot(event: Event) {
  emit('update:rootId', (event.target as HTMLSelectElement).value)
}

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset immediately so choosing the same file again still produces a change.
  input.value = ''
  if (!file) return
  invalidateFileRead()
  fileError.value = ''
  if (!/\.(lua|txt)$/i.test(file.name)) {
    fileError.value = '请选择 .lua 或 .txt 格式的 Data 文件。'
    return
  }
  if (file.size > MAX_SOURCE_BYTES) {
    fileError.value = '文件超过 2 MiB，请选择更小的 Data 文件。'
    return
  }
  const token = readToken
  const startingSource = props.sourceText
  readingFile.value = true
  try {
    const source = await file.text()
    if (unmounted || token !== readToken || props.sourceText !== startingSource) return
    readingFile.value = false
    emit('update:sourceText', source)
  } catch {
    if (unmounted || token !== readToken) return
    fileError.value = '无法读取文件，请重试或直接粘贴 Timeline Data 源码。'
  } finally {
    if (!unmounted && token === readToken) readingFile.value = false
  }
}

// A parent-driven source change must also invalidate an outstanding file read.
watch(() => props.sourceText, () => {
  if (readingFile.value) invalidateFileRead()
}, { flush: 'sync' })

function confirm() {
  if (!canConfirm.value || submissionPending) return
  submissionPending = true
  emit('confirm')
  void nextTick(() => { submissionPending = false })
}

function close() {
  invalidateFileRead()
  emit('close')
}

function formatDuration(duration: number) {
  return Number.isFinite(duration) ? String(Number(duration.toFixed(3))) : '—'
}

function trapFocus(event: KeyboardEvent) {
  event.stopPropagation()
  const dialog = dialogElement.value
  if (!dialog) return
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), select:not(:disabled), input:not(:disabled):not([hidden]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])'))
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = window.document.activeElement
  if (!first || !last) {
    event.preventDefault()
    dialog.focus({ preventScroll: true })
  } else if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previousFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
  await nextTick()
  if (!unmounted) sourceInput.value?.focus({ preventScroll: true })
})

onBeforeUnmount(() => {
  unmounted = true
  invalidateFileRead()
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = null
})
</script>

<style scoped>
.timeline-import-backdrop { position: fixed; inset: 0; z-index: 1500; display: flex; align-items: center; justify-content: center; padding: 20px; background: #0a0d14b5; backdrop-filter: blur(3px); }
.timeline-import-dialog { box-sizing: border-box; width: min(760px, 100%); max-height: calc(100vh - 40px); max-height: calc(100dvh - 40px); overflow: auto; margin: 0; padding: 22px; color: #d9dfeb; font: inherit; font-size: 13px; line-height: 1.6; background: #1d222c; border: 1px solid #48536b; border-radius: 10px; box-shadow: 0 24px 90px #0009; outline: none; }
.timeline-import-dialog * { box-sizing: border-box; }
h2 { margin: 0 0 10px; color: #f0f3f9; font-size: 17px; font-weight: 600; }
h3 { margin: 0 0 9px; color: #d9e3f5; font-size: 13px; font-weight: 600; }
p { margin: 0; overflow-wrap: anywhere; }
header p, .preview-empty { color: #a4b2c9; }
.source-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 18px 0 8px; color: #becbe1; }
textarea, select { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid #4d5c79; border-radius: 5px; background: #151c27; color: #e0e9fa; font: inherit; font-size: 13px; outline: none; }
textarea { display: block; min-height: 150px; height: 180px; max-height: 40vh; resize: vertical; font-family: Consolas, Monaco, monospace; line-height: 1.55; tab-size: 2; }
textarea::placeholder { color: #7f8ba1; }
textarea:focus, select:focus { border-color: #91aaff; box-shadow: 0 0 0 2px #7999ff26; }
.field-help { margin-top: 6px; color: #9aaac3; font-size: 12px; }
.read-status { margin-top: 8px; color: #b4c7ff; }
.root-field { display: flex; flex-direction: column; gap: 7px; margin-top: 17px; color: #becbe1; }
.mode-field { display: flex; flex-wrap: wrap; gap: 10px 22px; min-width: 0; padding: 0; margin: 17px 0 0; border: 0; }
.mode-field legend { margin-bottom: 7px; padding: 0; color: #becbe1; }
.mode-field label { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 7px; white-space: nowrap; cursor: pointer; }
.mode-field input[type="radio"] { flex: 0 0 14px; width: 14px; height: 14px; margin: 0; padding: 0; border: 0; accent-color: #91aaff; }
.mode-field input:focus-visible { outline: 2px solid #a4baff; outline-offset: 3px; }
.notice { margin-top: 12px; padding: 10px 12px; border: 1px solid; border-radius: 5px; font-size: 12px; overflow-wrap: anywhere; }
.notice strong { display: block; margin-bottom: 3px; font-weight: 600; }
.notice ul { margin: 5px 0; padding-left: 19px; }
.notice li + li { margin-top: 4px; }
.error-notice { color: #ffbdc9; background: #492c39; border-color: #6e4253; }
.warning-notice { color: #f4d394; background: #393328; border-color: #776244; }
.replace-notice { color: #ffe0b7; background: #483529; border-color: #ad7745; border-left-width: 4px; }
.preview-section { margin-top: 20px; padding-top: 15px; border-top: 1px solid #394458; }
.preview-summary { display: grid; grid-template-columns: .8fr 1.3fr 1fr; gap: 10px; margin: 0; }
.preview-summary div { min-width: 0; padding: 9px 11px; border: 1px solid #3e4a60; border-radius: 5px; background: #19212d; }
.preview-summary dt { color: #a4b2c9; font-size: 12px; }
.preview-summary dd { margin: 3px 0 0; color: #e0e9fa; overflow-wrap: anywhere; }
footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 23px; }
button { display: inline-flex; align-items: center; justify-content: center; min-height: 33px; padding: 6px 14px; margin: 0; border: 1px solid #455069; border-radius: 5px; background: #2b3342; color: #cdd8ec; font: inherit; font-size: 12px; cursor: pointer; }
button:not(:disabled):hover { background: #364258; border-color: #677fa7; color: #fff; }
button:focus-visible { outline: 2px solid #a4baff; outline-offset: 2px; }
button:disabled { cursor: not-allowed; opacity: .4; }
.primary-action { color: #fff; background: #4a6dde; border-color: #6c89ea; }
.primary-action:not(:disabled):hover { background: #597beb; border-color: #8ba4fb; }
.replace-action { color: #fff0df; background: #86522e; border-color: #b77a4c; }
.replace-action:not(:disabled):hover { background: #99613a; border-color: #d89b67; }
@media (max-width: 540px) { .timeline-import-backdrop { padding: 12px; } .timeline-import-dialog { padding: 18px; max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); } .preview-summary { grid-template-columns: 1fr; } .mode-field { flex-direction: column; } }
</style>
