<template>
  <div class="archive-action-backdrop" @pointerdown.stop @click.self="cancel" @keydown.stop>
    <form
      ref="dialogElement"
      class="archive-action-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-ui-archive-action-title"
      aria-describedby="client-ui-archive-action-message"
      :aria-busy="busy"
      tabindex="-1"
      @submit.prevent="submit"
      @keydown.esc.stop.prevent="cancel"
      @keydown.tab="trapFocus"
    >
      <h2 id="client-ui-archive-action-title">{{ title }}</h2>
      <p id="client-ui-archive-action-message">{{ message }}</p>
      <label v-if="mode === 'name'" class="name-field">
        <span>名称</span>
        <input ref="nameInput" v-model="value" type="text" :disabled="busy" autocomplete="off" spellcheck="false" aria-label="名称" />
      </label>
      <div v-if="error" class="action-error" role="alert">{{ error }}</div>
      <footer>
        <button type="button" :disabled="busy" @click="cancel">取消</button>
        <button ref="submitButton" class="primary-action" :class="{ 'danger-action': mode === 'confirm' }" type="submit" :disabled="busy">{{ busy ? '正在处理…' : mode === 'confirm' ? '移至回收站' : '确认' }}</button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  title: string
  message: string
  mode: 'name' | 'confirm'
  initialValue: string
  busy: boolean
  error: string
}>()
const emit = defineEmits<{
  (event: 'submit', value: string): void
  (event: 'cancel'): void
}>()

const value = ref(props.initialValue)
const dialogElement = ref<HTMLFormElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const submitButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
let submissionPending = false

function submit() {
  if (props.busy || submissionPending) return
  submissionPending = true
  emit('submit', value.value.trim())
  // Let the parent publish its busy state before accepting another event.
  void nextTick(() => { submissionPending = false })
}

function restoreFocus() {
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = null
}

function cancel() {
  if (props.busy || submissionPending) return
  restoreFocus()
  emit('cancel')
}

function trapFocus(event: KeyboardEvent) {
  event.stopPropagation()
  const dialog = dialogElement.value
  if (!dialog) return
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'))
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

onMounted(async () => {
  previousFocus = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
  await nextTick()
  if (props.mode === 'name' && nameInput.value && !props.busy) {
    nameInput.value.focus({ preventScroll: true })
    nameInput.value.select()
  } else if (submitButton.value && !props.busy) {
    submitButton.value.focus({ preventScroll: true })
  } else {
    dialogElement.value?.focus({ preventScroll: true })
  }
})

onBeforeUnmount(restoreFocus)
</script>

<style scoped>
.archive-action-backdrop { position: fixed; inset: 0; z-index: 1500; display: flex; align-items: center; justify-content: center; padding: 20px; background: #0a0d14b5; backdrop-filter: blur(3px); }
.archive-action-dialog { width: min(430px, 100%); max-height: calc(100vh - 40px); max-height: calc(100dvh - 40px); overflow: auto; margin: 0; padding: 22px; color: #d9dfeb; font-family: inherit; font-size: 13px; line-height: 1.6; background: #1d222c; border: 1px solid #48536b; border-radius: 10px; box-shadow: 0 24px 90px #0009; outline: none; }
.archive-action-dialog * { box-sizing: border-box; }
.archive-action-dialog h2 { margin: 0 0 10px; color: #f0f3f9; font-size: 17px; font-weight: 600; }
.archive-action-dialog p { margin: 0; color: #a4b2c9; white-space: pre-line; overflow-wrap: anywhere; }
.name-field { display: flex; flex-direction: column; gap: 7px; margin-top: 19px; color: #becbe1; font-size: 12px; }
.name-field input { width: 100%; min-width: 0; height: 37px; padding: 7px 10px; border: 1px solid #4d5c79; border-radius: 5px; background: #151c27; color: #e0e9fa; font: inherit; font-size: 13px; outline: none; }
.name-field input:focus { border-color: #91aaff; box-shadow: 0 0 0 2px #7999ff26; }
.name-field input:disabled { opacity: .5; }
.action-error { margin-top: 15px; padding: 9px 11px; color: #ffbdc9; background: #492c39; border: 1px solid #6e4253; border-radius: 5px; font-size: 12px; overflow-wrap: anywhere; }
.archive-action-dialog footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 23px; }
.archive-action-dialog button { display: inline-flex; align-items: center; justify-content: center; min-height: 33px; padding: 6px 14px; margin: 0; border: 1px solid #455069; border-radius: 5px; background: #2b3342; color: #cdd8ec; font: inherit; font-size: 12px; cursor: pointer; }
.archive-action-dialog button:not(:disabled):hover { background: #364258; border-color: #677fa7; color: #fff; }
.archive-action-dialog button:focus-visible { outline: 2px solid #a4baff; outline-offset: 2px; }
.archive-action-dialog button:disabled { cursor: not-allowed; opacity: .4; }
.archive-action-dialog .primary-action { color: #fff; background: #4a6dde; border-color: #6c89ea; }
.archive-action-dialog .primary-action:not(:disabled):hover { background: #597beb; border-color: #8ba4fb; }
.archive-action-dialog .danger-action { color: #ffe5eb; background: #8c4158; border-color: #b4647c; }
.archive-action-dialog .danger-action:not(:disabled):hover { background: #a04b65; border-color: #d4829b; }
@media (max-width: 480px) { .archive-action-backdrop { padding: 12px; } .archive-action-dialog { padding: 18px; max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); } }
</style>
