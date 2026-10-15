<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import StyleParameterSettings from "./StyleParameterSettings.vue";
import TypedValueInput from "../TypedValueInput.vue";
import type { PresetReference } from "./presetReferences";
import { createStylePreset, getStylePresetValueType, supportsCustomStylePresets, supportsEditableSystemStylePresets, supportsStyleParameters, useStylePresets, type StylePresetCategory } from "./stylePresets";
const props = defineProps<{ category: StylePresetCategory; title: string; referenceSources: PresetReference[] }>();
const supportsCustom = computed(() => supportsCustomStylePresets(props.category));
const editableSystem = computed(() => supportsEditableSystemStylePresets(props.category));
const editableSystemValue = computed(() => editableSystem.value && props.category !== "selectStyles");
const supportsParameters = computed(() => supportsStyleParameters(props.category));
const valueType = computed(() => getStylePresetValueType(props.category));
const valueLabel = computed(() => props.category === "cameras" ? "相机名称" : "类型值");
const { customPresets, systemPresets, availablePresets, ready, error, status, retry, flush } = useStylePresets(props.category);
const systemIDs = computed(() => new Set(systemPresets.value.map(preset => preset.id)));
const entries = computed(() => availablePresets.value.map(preset => ({
  id: preset.id,
  label: preset.label || preset.value || "未命名预设",
  detail: preset.value,
  system: systemIDs.value.has(preset.id),
})));
const list = ref<HTMLElement>();
async function add() {
  if (!supportsCustom.value) return;
  customPresets.value = [...customPresets.value, createStylePreset(props.category)];
  await nextTick();
  list.value?.querySelector<HTMLElement>("article:last-child input")?.focus();
}
defineExpose({ flush, category: props.category, entries });
</script>

<template>
  <section class="style-preset-section" :data-preset-category="category" :aria-label="`${title}预设`">
    <header><div><h3>{{ title }}</h3><p>显示名称用于选择，{{ valueLabel }}按原文保存和导出。</p></div></header>
    <p role="status">{{ supportsCustom ? status : '系统预设 · 只读' }}</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></p>
    <p v-if="editableSystemValue">系统预设提供默认值，显示名称固定，实际值可修改。自定义预设可新增、编辑和删除，当前工作区共用。</p>
    <p v-else-if="supportsParameters">系统预设的显示名称和类型值固定，可编辑参数。自定义预设可新增、编辑和删除，当前工作区共用。</p>
    <p v-else-if="supportsCustom">系统预设只读。自定义预设可新增、编辑和删除，当前工作区共用。</p>
    <p v-if="supportsCustom">修改预设不会改写已配置的内容。</p>
    <p v-if="category === 'dialogueStyles'">显示标题控制文本编辑中的标题（说话人）和副标题；关闭时导出为空，已填写的文字保留在工程中。</p>
    <p v-if="supportsParameters">参数名称、值来源和默认值在参数设置中定义，类型固定为整数。文本或选项使用该预设后，按定义的参数填写入参。</p>
    <h4>{{ editableSystem ? '系统预设 · 默认值' : '系统预设 · 只读' }}</h4>
    <div class="items system-items">
      <article v-for="(preset, index) in systemPresets" :key="preset.id" :data-preset-id="preset.id" tabindex="-1" :class="{ 'dialogue-style': category === 'dialogueStyles' }" :aria-label="`系统${title}预设 ${index + 1}`">
        <div>显示名称<p>{{ preset.label || preset.value }}</p></div>
        <label v-if="editableSystemValue">{{ valueLabel }}<input v-model="preset.value" :disabled="!ready" :aria-label="`系统${title} ${index + 1} ${valueLabel}`" :placeholder="`填写实际使用的${valueLabel}`" /></label>
        <div v-else>{{ valueLabel }}<p>{{ preset.value }}</p></div>
        <label v-if="category === 'dialogueStyles'" class="show-title-toggle"><input v-model="preset.showTitle" :disabled="!ready" type="checkbox" :aria-label="`系统${title} ${index + 1} 显示标题`" />显示标题</label>
        <span>系统</span>
        <small v-if="editableSystemValue && !preset.value.trim()">填写{{ valueLabel }}后即可在编辑器中选择。</small>
        <StyleParameterSettings v-if="supportsParameters" v-model="preset.parameters" class="parameter-settings" :reference-sources="referenceSources" :disabled="!ready" :label="`系统${title} ${index + 1}`" />
      </article>
    </div>
    <p v-if="!systemPresets.length">暂无系统预设。</p>
    <template v-if="supportsCustom">
    <header><h4>自定义预设</h4></header>
    <div ref="list" class="items">
      <article v-for="(preset, index) in customPresets" :key="preset.id" :data-preset-id="preset.id" tabindex="-1" :class="{ 'dialogue-style': category === 'dialogueStyles' }" :aria-label="`${title}预设 ${index + 1}`">
        <label>显示名称<input v-model="preset.label" :aria-label="`${title} ${index + 1} 显示名称`" placeholder="例如：默认样式" /></label>
        <label>{{ valueLabel }}<TypedValueInput v-if="valueType === 'Int32'" v-model="preset.value" :value-type="valueType" :aria-label="`${title} ${index + 1} ${valueLabel}`" placeholder="填写整数值" /><input v-else v-model="preset.value" :aria-label="`${title} ${index + 1} ${valueLabel}`" :placeholder="`填写实际使用的${valueLabel}`" /></label>
        <label v-if="category === 'dialogueStyles'" class="show-title-toggle"><input v-model="preset.showTitle" type="checkbox" :aria-label="`${title} ${index + 1} 显示标题`" />显示标题</label>
        <button type="button" :aria-label="`删除${title}预设 ${index + 1}`" @click="customPresets = customPresets.filter(item => item.id !== preset.id)">删除</button>
        <small v-if="!preset.value.trim()">填写{{ valueLabel }}后即可在编辑器中选择。</small>
        <small v-else-if="availablePresets.some(item => item !== preset && item.value === preset.value)">{{ valueLabel }}重复，选择列表优先显示系统预设，再显示第一项自定义预设。</small>
        <StyleParameterSettings v-if="supportsParameters" v-model="preset.parameters" class="parameter-settings" :reference-sources="referenceSources" :disabled="!ready" :label="`${title} ${index + 1}`" />
      </article>
    </div>
    <p v-if="ready && !customPresets.length">暂无自定义预设，可以点击新建添加。</p>
    <div class="preset-footer"><button type="button" :disabled="!ready" @click="add">＋ 新建{{ title }}预设</button></div>
    </template>
  </section>
</template>

<style scoped>
.style-preset-section { max-width: none; margin-top: 0; padding: 20px; border: 1px solid #dbe4ef; border-radius: 12px; background: #fff; container: style-preset-section / inline-size; }
header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
h3 { font-size: 16px; margin: 0 0 6px; }
p { color: #7c899c; font-size: 12px; line-height: 1.7; margin: 4px 0; }
.items { display: grid; gap: 12px; margin-top: 20px; max-width: none; }
.system-items article { background: #f4f7fb; color: #617189; overflow-wrap: anywhere; }
article { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) auto; align-items: center; gap: 16px; padding: 18px; border: 1px solid #dbe4ef; border-radius: 10px; }
.system-items article { grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) auto; }
label { display: grid; gap: 6px; color: #75839a; font-size: 12px; }
article.dialogue-style, .system-items article.dialogue-style { grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) auto auto; }
.show-title-toggle { display: flex; align-items: center; gap: 8px; }
.show-title-toggle input { width: 16px; height: 16px; accent-color: #6a5acd; }
input,select { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px; border: 1px solid #d4deeb; border-radius: 5px; font: inherit; color: #334158; background: #fafcff; }
button { cursor: pointer; border: 1px solid #bed0e5; border-radius: 6px; padding: 8px 12px; color: #315f98; background: #edf4fd; font: inherit; font-size: 12px; }
button:disabled { opacity: .4; cursor: default; }
.preset-footer { display: flex; justify-content: flex-end; margin-top: 20px; }
small { grid-column: 1 / -1; color: #9b8359; }
.parameter-settings { grid-column: 1 / -1; }
@container style-preset-section (max-width: 640px) { article, article.dialogue-style, .system-items article, .system-items article.dialogue-style { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 760px) { .style-preset-section { padding: 14px; } article, article.dialogue-style, .system-items article, .system-items article.dialogue-style { grid-template-columns: minmax(0, 1fr); } }
</style>
