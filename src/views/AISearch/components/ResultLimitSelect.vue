<template>
  <span ref="control" class="result-limit-select">
    <NSelect id="search-result-limit" size="small" :value="modelValue" :options="options" :disabled="disabled"
      :show="show" :aria-label="t('aiSearch.resultLimit')" :input-props="{ 'aria-label': t('aiSearch.resultLimit') }"
      placement="top-start" :consistent-menu-width="false" display-directive="if"
      :theme-overrides="theme" :menu-props="menuProps" :node-props="nodeProps"
      @update:show="updateShow" @update:value="choosePreset">
      <template #action>
        <form class="result-limit-custom" novalidate @submit.prevent="applyCustom" @keydown.stop="handleCustomKey">
          <label for="search-result-limit-custom">{{ t('aiSearch.resultLimitCustom') }}</label>
          <div class="result-limit-custom-row">
            <input id="search-result-limit-custom" v-model="customDraft" type="text" inputmode="numeric" pattern="[0-9]*"
              maxlength="2" autocomplete="off" :disabled="disabled" :aria-invalid="customInvalid"
              aria-describedby="search-result-limit-range" :placeholder="t('aiSearch.resultLimitCustomPlaceholder', { max: MAX_SEARCH_RESULTS })" />
            <button type="submit" :disabled="disabled || !customValid">{{ t('aiSearch.resultLimitApply') }}</button>
          </div>
          <p id="search-result-limit-range" :class="{ 'invalid-count': customInvalid }">{{ t('aiSearch.resultLimitRange', { max: MAX_SEARCH_RESULTS }) }}</p>
        </form>
      </template>
    </NSelect>
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { NSelect, type SelectProps } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { MAX_SEARCH_RESULTS, SEARCH_RESULT_LIMITS, normalizeResultLimit } from '../resultLimits'

const props = defineProps<{ modelValue: number; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const { t } = useI18n({ useScope: 'global' })
const control = ref<HTMLElement>()
const show = ref(false)
const customDraft = ref(String(normalizeResultLimit(props.modelValue)))
const customCount = computed(() => Number(customDraft.value.trim()))
const customValid = computed(() => /^\d+$/.test(customDraft.value.trim()) && Number.isInteger(customCount.value) && customCount.value >= 1 && customCount.value <= MAX_SEARCH_RESULTS)
const customInvalid = computed(() => Boolean(customDraft.value.trim()) && !customValid.value)
const options = computed(() => {
  const values: number[] = [...SEARCH_RESULT_LIMITS]
  if (Number.isInteger(props.modelValue) && props.modelValue >= 1 && props.modelValue <= MAX_SEARCH_RESULTS && !values.includes(props.modelValue)) values.push(props.modelValue)
  return values.map(value => ({ value, label: t('aiSearch.resultLimitOption', { count: value }) }))
})
const menuProps = computed(() => ({
  class: 'ai-result-limit-menu', 'aria-label': t('aiSearch.resultLimit'),
  style: { minWidth: '232px', maxWidth: 'calc(100vw - 24px)' },
}))
const nodeProps: NonNullable<SelectProps['nodeProps']> = option => ({
  'data-result-limit-option': option.value, style: { borderRadius: '6px' },
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

function updateShow(value: boolean) {
  show.value = !props.disabled && value
  if (show.value) customDraft.value = String(normalizeResultLimit(props.modelValue))
}
function closeMenu() {
  show.value = false
  void nextTick(() => control.value?.querySelector<HTMLElement>('[role="combobox"]')?.focus())
}
function choosePreset(value: unknown) {
  if (props.disabled || typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_SEARCH_RESULTS) return
  emit('update:modelValue', value)
  closeMenu()
}
function applyCustom() {
  if (props.disabled || !customValid.value) return
  emit('update:modelValue', customCount.value)
  closeMenu()
}
function handleCustomKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu() }
}
watch(() => props.disabled, value => { if (value) show.value = false })
watch(() => props.modelValue, () => { show.value = false })
</script>

<style scoped>
.result-limit-select { display: inline-block; width: 126px; min-width: 0; max-width: 100%; flex-shrink: 0; }
.result-limit-custom { padding: 7px 4px 2px; color: #465471; font-size: 12px; }
.result-limit-custom label { display: block; margin-bottom: 7px; font-weight: 600; }
.result-limit-custom-row { display: flex; align-items: center; gap: 7px; }
.result-limit-custom input { width: 0; min-width: 0; flex: 1; height: 32px; padding: 5px 9px; border: 1px solid #dce2ee; border-radius: 7px; outline: none; background: #fff; color: #25324c; font: inherit; }
.result-limit-custom input:focus { border-color: #1976d2; box-shadow: 0 0 0 2px #1976d219; }
.result-limit-custom input[aria-invalid="true"] { border-color: #b22a48; }
.result-limit-custom button { flex-shrink: 0; min-height: 32px; padding: 5px 10px; border: 1px solid #1976d2; border-radius: 7px; background: #1976d2; color: #fff; font: inherit; cursor: pointer; }
.result-limit-custom button:hover:not(:disabled) { background: #1565b7; }
.result-limit-custom button:focus-visible { outline: 2px solid #54a8ff; outline-offset: 2px; }
.result-limit-custom button:disabled { opacity: .45; cursor: not-allowed; }
.result-limit-custom p { margin: 7px 0 0; color: #6b7690; font-size: 11px; line-height: 1.5; }
.result-limit-custom p.invalid-count { color: #b22a48; }
</style>
