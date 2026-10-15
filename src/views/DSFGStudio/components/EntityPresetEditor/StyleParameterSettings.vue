<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import StudioSelectField from "../StudioSelectField.vue";
import TypedValueInput from "../TypedValueInput.vue";
import { compatibleReference, type PresetReference } from "./presetReferences";
import { createStyleParameter, type StyleParameter } from "./stylePresets";

const props = defineProps<{
  modelValue?: StyleParameter[];
  referenceSources: PresetReference[];
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: StyleParameter[]] }>();
const parameters = computed(() => props.modelValue ?? []);
const integerSources = computed(() => props.referenceSources.filter(source => compatibleReference(source, "Int32")));
const rows = ref<HTMLElement>();

async function addParameter() {
  if (props.disabled || parameters.value.length >= 100) return;
  emit("update:modelValue", [...parameters.value, createStyleParameter()]);
  await nextTick();
  rows.value?.querySelector<HTMLInputElement>(".parameter-row:last-child .parameter-name")?.focus();
}
function removeParameter(index: number) {
  if (props.disabled) return;
  emit("update:modelValue", parameters.value.filter((_, position) => position !== index));
}
function moveParameter(index: number, direction: -1 | 1) {
  const destination = index + direction;
  if (props.disabled || destination < 0 || destination >= parameters.value.length) return;
  const reordered = [...parameters.value];
  reordered.splice(destination, 0, reordered.splice(index, 1)[0]);
  emit("update:modelValue", reordered);
}
</script>

<template>
  <details class="style-parameters">
    <summary>
      <span class="parameter-arrow" aria-hidden="true">▸</span>
      <span>参数设置</span>
      <span class="parameter-count">{{ parameters.length }} / 100</span>
    </summary>
    <div class="parameter-body">
      <p class="parameter-description">按列表顺序传入整数，最多 100 项；未设置参数时保持空列表。</p>
      <div ref="rows" class="parameter-list">
        <div v-for="(param, index) in parameters" :key="param.id" class="parameter-row">
          <div class="parameter-fields">
            <label>参数名称<input v-model="param.name" class="parameter-name" :disabled="disabled" :aria-label="`${label} 参数 ${index + 1} 名称`" placeholder="例如：角色编号" /></label>
            <div class="parameter-type"><span>类型</span><p>整数（Int32）</p></div>
            <label>值来源<StudioSelectField v-model="param.reference" :disabled="disabled" :aria-label="`${label} 参数 ${index + 1} 值来源`"><option :value="undefined">手动填写</option><option v-if="param.reference && !integerSources.some(source => source.value === param.reference)" :value="param.reference">引用已失效（可重新选择）</option><option v-for="source in integerSources" :key="source.value" :value="source.value">{{ source.label }}</option></StudioSelectField></label>
            <label>默认值<TypedValueInput v-model="param.defaultValue" value-type="Int32" :disabled="disabled" :aria-label="`${label} 参数 ${index + 1} 默认值`" placeholder="默认值（可选）" /></label>
          </div>
          <div class="parameter-actions">
            <button type="button" class="parameter-move" :disabled="disabled || index === 0" :aria-label="`${label} 上移参数 ${index + 1}`" title="上移参数" @click="moveParameter(index, -1)">↑</button>
            <button type="button" class="parameter-move" :disabled="disabled || index === parameters.length - 1" :aria-label="`${label} 下移参数 ${index + 1}`" title="下移参数" @click="moveParameter(index, 1)">↓</button>
            <button type="button" class="parameter-delete" :disabled="disabled" :aria-label="`${label} 删除参数 ${index + 1}`" @click="removeParameter(index)">删除参数</button>
          </div>
        </div>
      </div>
      <p v-if="!parameters.length" class="empty-parameters">暂无参数。添加后，可在文本或选项编辑中按参数名称填写入参。</p>
      <button type="button" class="parameter-add" :disabled="disabled || parameters.length >= 100" @click="addParameter">＋ 添加参数</button>
    </div>
  </details>
</template>

<style scoped>
.style-parameters { min-width: 0; color: #334158; border-top: 1px solid #e1e7f2; container: style-parameters / inline-size; }
summary { display: flex; align-items: center; gap: 6px; padding: 13px 0 0; list-style: none; cursor: pointer; color: #526d92; font-size: 12px; }
summary::-webkit-details-marker { display: none; }
summary:focus-visible { outline: 2px solid #b4d0f4; outline-offset: 4px; border-radius: 4px; }
.parameter-arrow { display: inline-block; transition: transform .15s ease; }
details[open] > summary .parameter-arrow { transform: rotate(90deg); }
.parameter-count { margin-left: auto; color: #8693a6; }
.parameter-body { display: grid; gap: 12px; min-width: 0; padding-top: 12px; text-align: left; }
.parameter-description, .empty-parameters { margin: 0; color: #8693a6; font-size: 12px; line-height: 1.7; }
.parameter-list { display: grid; gap: 12px; min-width: 0; }
.parameter-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; min-width: 0; padding: 14px; border: 1px solid #e0e7f2; border-radius: 8px; background: #f8faff; }
.parameter-fields { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr) repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; min-width: 0; }
label, .parameter-type { display: grid; gap: 6px; min-width: 0; color: #75839a; font-size: 12px; }
.parameter-type p { box-sizing: border-box; min-height: 38px; margin: 0; padding: 9px; border: 1px solid #e1e7f2; border-radius: 5px; background: #f1f4fa; color: #65748b; }
input { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px; border: 1px solid #d4deeb; border-radius: 5px; font: inherit; color: #334158; background: #fafcff; }
input:focus { outline: 2px solid #b4d0f4; }
input:disabled { opacity: .5; }
.parameter-fields :deep(.studio-select-field) { width: 100%; min-width: 0; }
.parameter-actions { display: flex; align-items: center; align-self: start; gap: 6px; padding-top: 20px; }
button { cursor: pointer; border: 1px solid #bed0e5; border-radius: 6px; padding: 8px 12px; color: #315f98; background: #edf4fd; font: inherit; font-size: 12px; }
button:disabled { opacity: .4; cursor: default; }
.parameter-actions button { height: 38px; padding: 0 10px; white-space: nowrap; }
.parameter-actions .parameter-move { width: 34px; padding: 8px 0; }
.parameter-actions .parameter-delete { color: #987787; background: #fff; border-color: #e2dce8; }
.parameter-add { justify-self: start; }
@container style-parameters (max-width: 780px) { .parameter-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container style-parameters (max-width: 540px) { .parameter-row { grid-template-columns: minmax(0, 1fr); } .parameter-actions { justify-self: end; padding-top: 0; } }
@container style-parameters (max-width: 360px) { .parameter-fields { grid-template-columns: minmax(0, 1fr); } .parameter-row { padding: 10px; } }
</style>
