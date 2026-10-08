<template>
  <span class="search-mode-select" :data-search-mode="modelValue" :data-disabled="Boolean(disabled)">
    <NSelect id="search-model-mode" size="small" :value="modelValue" :options="options" :disabled="disabled"
      :show="show" :aria-label="t('aiSearch.modelSettings')" :input-props="{ 'aria-label': t('aiSearch.modelSettings') }"
      placement="top-start" :consistent-menu-width="false" display-directive="if"
      :theme-overrides="theme" :menu-props="menuProps" :render-label="renderLabel" :node-props="nodeProps"
      @update:show="updateShow" @update:value="updateValue" />
  </span>
</template>

<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { NSelect, type SelectOption, type SelectProps } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { SearchMode } from '../types'
import SearchIcon from './SearchIcon.vue'

const props = defineProps<{ modelValue: SearchMode; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: SearchMode] }>()
const { t } = useI18n({ useScope: 'global' })
const show = ref(false)
const modes: SearchMode[] = ['free', 'custom', 'basic']
const options = computed(() => modes.map(value => ({ value, label: t(`aiSearch.modes.${value}`) })))
const menuProps = computed(() => ({
  class: 'ai-model-select-menu', role: 'listbox', 'aria-label': t('aiSearch.modelSettings'),
  style: { minWidth: '190px', maxWidth: 'calc(100vw - 24px)' },
}))
const nodeProps: NonNullable<SelectProps['nodeProps']> = option => ({
  role: 'option', 'aria-selected': option.value === props.modelValue, 'data-search-mode-option': option.value,
  style: { borderRadius: '6px' },
})
const theme: NonNullable<SelectProps['themeOverrides']> = {
  menuBoxShadow: '0 8px 28px #26324b26',
  peers: {
    InternalSelection: {
      borderRadius: '7px', color: '#fff', colorActive: '#fff', textColor: '#42648d',
      border: '1px solid #dce2ee', borderHover: '1px solid #9dc3ec', borderActive: '1px solid #1976d2',
      borderFocus: '1px solid #1976d2', boxShadowFocus: '0 0 0 2px #1976d219', boxShadowActive: '0 0 0 2px #1976d219',
      arrowColor: '#62718a', fontSizeSmall: '12px', heightSmall: '32px',
    },
    InternalSelectMenu: {
      borderRadius: '10px', color: '#fff', optionTextColor: '#465471', optionTextColorActive: '#1976d2',
      optionCheckColor: '#1976d2', optionColorPending: '#edf5ff', optionColorActive: '#e7f2ff',
      optionColorActivePending: '#dceeff', paddingSmall: '6px', optionPaddingSmall: '8px 10px',
      optionFontSizeSmall: '12px', optionHeightSmall: '38px',
    },
  },
}
const renderLabel = (option: SelectOption) => {
  const value = option.value
  return h('span', { class: 'ai-model-option-label', style: { display: 'inline-flex', alignItems: 'center', gap: '7px', minWidth: '0' } }, [
    h(SearchIcon, { name: value === 'basic' ? 'chat' : value === 'custom' ? 'settings' : 'sparkles', style: { width: '15px', height: '15px', flexShrink: '0' } }),
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(option.label ?? '')),
  ])
}
function updateShow(value: boolean) { show.value = !props.disabled && value }
function updateValue(value: unknown) {
  if (props.disabled) return
  if (value === 'free' || value === 'custom' || value === 'basic') { emit('update:modelValue', value); show.value = false }
}
watch(() => props.disabled, value => { if (value) show.value = false })
watch(() => props.modelValue, () => { show.value = false })
</script>

<style scoped>
.search-mode-select { display: inline-block; width: 145px; min-width: 0; max-width: 100%; flex-shrink: 0; }
@media (max-width: 600px) { .search-mode-select { width: 132px; } }
</style>
