<script setup lang="ts" generic="Value extends string">
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue'
import { NPopover } from 'naive-ui'

const props = defineProps<{
  modelValue: Value
  options: readonly { value: Value; label: string }[]
  label: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()
const menuId = useId()
const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const portalTarget = shallowRef<HTMLElement | 'body'>('body')
const open = ref(false)
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue))
const currentLabel = computed(() => props.options[selectedIndex.value]?.label ?? '')
const popoverTheme = { color: '#fff', boxShadow: 'var(--dropdown-shadow)', spaceArrow: '12px', arrowHeight: '7px' }

function focusOption(index: number) {
  menu.value?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus()
}

async function show(last = false) {
  if (!trigger.value || props.disabled || !props.options.length) return
  portalTarget.value = trigger.value.closest('dialog') ?? 'body'
  open.value = true
  await nextTick()
  if (open.value) focusOption(last ? props.options.length - 1 : Math.max(0, selectedIndex.value))
}

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function onShowChange(value: boolean) {
  if (value) void show()
  else close()
}

function select(value: Value) {
  close(true)
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (open.value && next !== trigger.value && !menu.value?.contains(next)) close()
}

function onTriggerEscape(event: KeyboardEvent) {
  if (!open.value) return
  event.preventDefault()
  event.stopPropagation()
  close(true)
}

function onMenuKeydown(event: KeyboardEvent, index: number, value: Value) {
  const count = props.options.length
  switch (event.key) {
    case 'ArrowDown': focusOption((index + 1) % count); break
    case 'ArrowUp': focusOption((index + count - 1) % count); break
    case 'Home': focusOption(0); break
    case 'End': focusOption(count - 1); break
    case 'Enter':
    case ' ': select(value); break
    case 'Escape': close(true); break
    case 'Tab': close(true); return
    default: return
  }
  event.stopPropagation()
  event.preventDefault()
}

watch(() => props.disabled || !props.options.length, unavailable => { if (unavailable) close() })
</script>

<template>
  <span class="dropdown-select">
    <NPopover :show="open" :to="portalTarget" trigger="click" placement="bottom-end" raw
      :inert="!open" :disabled="disabled || !options.length" :theme-overrides="popoverTheme"
      class="dropdown-surface dropdown-select-popup" arrow-class="dropdown-select-arrow" @update:show="onShowChange">
      <template #trigger>
        <button ref="trigger" type="button" class="dropdown-trigger dropdown-select-trigger"
          :disabled="disabled || !options.length" :aria-label="currentLabel ? `${label}: ${currentLabel}` : label"
          aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? menuId : undefined"
          @focusout="onFocusOut" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)"
          @keydown.esc="onTriggerEscape">
          <span class="dropdown-select-label">
            <span v-for="option in options" :key="option.value" class="dropdown-select-measure" aria-hidden="true">{{ option.label }}</span>
            <span>{{ currentLabel }}</span>
          </span>
          <svg class="dropdown-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </template>
      <div :id="menuId" ref="menu" class="dropdown-select-options" role="listbox" :aria-label="label" @focusout="onFocusOut">
        <div v-for="(option, index) in options" :key="option.value" class="dropdown-option"
          role="option" :aria-selected="option.value === modelValue" tabindex="-1"
          @click="select(option.value)" @keydown="onMenuKeydown($event, index, option.value)">
          <span>{{ option.label }}</span>
          <svg v-if="option.value === modelValue" class="dropdown-check" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </div>
      </div>
    </NPopover>
  </span>
</template>

<style scoped>
.dropdown-select { display: inline-block; min-width: 0; max-width: 100%; }
.dropdown-select-trigger { width: 100%; justify-content: space-between; }
.dropdown-select-label { display: grid; min-width: 0; text-align: left; }
.dropdown-select-label > span { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dropdown-select-measure { visibility: hidden; }
</style>
