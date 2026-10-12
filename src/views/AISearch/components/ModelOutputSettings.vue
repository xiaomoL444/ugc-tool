<template>
  <section class="model-output-settings" aria-live="polite">
    <dl>
      <dt>{{ t('aiSearch.output.detected') }}</dt><dd>{{ t(`aiSearch.output.providers.${policy.provider}`) }}</dd>
      <dt>{{ t('aiSearch.output.selected') }}</dt><dd>{{ t(`aiSearch.output.modes.${policy.mode}`) }}</dd>
    </dl>
    <p>{{ t('aiSearch.output.detectionHint') }}</p>
    <p v-if="policy.inferred" class="model-output-inferred">{{ t('aiSearch.output.inferredHint') }}</p>
    <p v-if="policy.provider === 'qwen' && policy.requested === 'auto'" class="model-output-inferred">{{ t('aiSearch.output.qwenHint') }}</p>
    <label class="config-field"><span>{{ t('aiSearch.output.label') }}</span>
      <select :value="config.outputMode || 'auto'" @change="changeMode">
        <option value="auto">{{ t('aiSearch.output.modes.auto') }}</option>
        <option value="json_schema">{{ t('aiSearch.output.modes.json_schema') }}</option>
        <option v-if="policy.protocol !== 'anthropic'" value="json_object">{{ t('aiSearch.output.modes.json_object') }}</option>
        <option value="prompt">{{ t('aiSearch.output.modes.prompt') }}</option>
      </select>
      <small>{{ t(`aiSearch.output.hints.${policy.mode}`) }}</small>
    </label>
    <small>{{ t('aiSearch.output.overrideHint') }}</small>
    <div class="model-output-docs"><span>{{ t('aiSearch.output.docs') }}</span>
      <a href="https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses" target="_blank" rel="noopener noreferrer">OpenAI</a>
      <a href="https://api-docs.deepseek.com/zh-cn/guides/responses_api/" target="_blank" rel="noopener noreferrer">DeepSeek</a>
      <a href="https://docs.volcengine.com/docs/ark/create-model-responses-api?lang=zh" target="_blank" rel="noopener noreferrer">Doubao</a>
      <a href="https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses" target="_blank" rel="noopener noreferrer">Qwen</a>
      <a href="https://platform.claude.com/docs/en/build-with-claude/structured-outputs" target="_blank" rel="noopener noreferrer">Claude</a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { detectModelOutput } from '../../../../tools/ai-search-service/model-output-policy.mjs'
import type { OutputMode } from '../../../../tools/ai-search-service/model-output-policy.mjs'
import type { ModelConfig } from '../types'
const props = defineProps<{ config: ModelConfig }>()
const emit = defineEmits<{ (event: 'update:outputMode', value: OutputMode): void }>()
const { t } = useI18n({ useScope: 'global' })
const policy = computed(() => detectModelOutput(props.config))
watch(() => policy.value.protocol === 'anthropic' && props.config.outputMode === 'json_object', invalid => {
  if (invalid) emit('update:outputMode', 'auto')
}, { immediate: true })
function changeMode(event: Event) { emit('update:outputMode', (event.target as HTMLSelectElement).value as OutputMode) }
</script>

<style scoped>
.model-output-settings { margin-top: 12px; padding: 12px; border: 1px solid #c6d3e8; border-radius: 8px; background: #f5f8ff; color: #405575; font-size: 12px; line-height: 1.6; }
.model-output-settings dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.model-output-settings dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.model-output-settings p { margin: 8px 0; }
.model-output-settings small { display: block; }
.model-output-settings .config-field { display: grid; gap: 5px; margin: 10px 0 6px; }
.model-output-settings select { width: 100%; min-height: 40px; padding: 8px; border: 1px solid #bbc5d9; border-radius: 8px; background: #fff; color: #273550; font: inherit; }
.model-output-inferred { color: #7d622b; }
.model-output-docs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.model-output-docs a { color: #3867a5; }
</style>
