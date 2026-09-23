<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { createStylePreset, useStylePresets, type StylePresetCategory } from "./stylePresets";
const props = defineProps<{ category: StylePresetCategory; title: string }>();
const valueLabel = computed(() => props.category === "cameras" ? "相机名称" : props.category === "booleans" ? "布尔值" : "类型值");
const { presets, systemPresets, availablePresets, ready, error, status, retry, flush } = useStylePresets(props.category);
const list = ref<HTMLElement>();
async function add() {
  presets.value.push(createStylePreset(props.category));
  await nextTick();
  list.value?.querySelector<HTMLElement>("article:last-child input")?.focus();
}
defineExpose({ flush });
</script>

<template>
  <section class="style-preset-section" :aria-label="`${title}预设`">
    <header><div><h3>{{ title }}</h3><p>显示名称用于选择，{{ valueLabel }}按原文保存和导出。</p></div></header>
    <p role="status">{{ status }}</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></p>
    <p>当前工作区共用。修改或删除预设不会改写已配置的内容。</p>
    <h4>系统预设 · 只读</h4>
    <div class="items system-items">
      <article v-for="preset in systemPresets" :key="preset.id"><div>显示名称<p>{{ preset.label || preset.value }}</p></div><div>{{ valueLabel }}<p>{{ preset.value }}</p></div><span>系统</span></article>
    </div>
    <p v-if="!systemPresets.length">暂无系统预设。</p>
    <header><h4>自定义预设</h4><button type="button" :disabled="!ready" @click="add">＋ 新建{{ title }}预设</button></header>
    <div ref="list" class="items">
      <article v-for="(preset, index) in presets" :key="preset.id">
        <label>显示名称<input v-model="preset.label" :aria-label="`${title} ${index + 1} 显示名称`" placeholder="例如：默认样式" /></label>
        <label>{{ valueLabel }}<select v-if="category === 'booleans'" v-model="preset.value" :aria-label="`${title} ${index + 1} ${valueLabel}`"><option value="0">否（0）</option><option value="1">是（1）</option></select><input v-else v-model="preset.value" :aria-label="`${title} ${index + 1} ${valueLabel}`" :placeholder="`填写实际使用的${valueLabel}`" /></label>
        <button type="button" :aria-label="`删除${title}预设 ${index + 1}`" @click="presets = presets.filter(item => item.id !== preset.id)">删除</button>
        <small v-if="!preset.value.trim()">填写{{ valueLabel }}后即可在编辑器中选择。</small>
        <small v-else-if="availablePresets.some(item => item !== preset && item.value === preset.value)">{{ valueLabel }}重复，选择列表优先显示系统预设，再显示第一项自定义预设。</small>
      </article>
    </div>
    <p v-if="ready && !presets.length">暂无自定义预设，可以点击新建添加。</p>
  </section>
</template>

<style scoped>
.style-preset-section { max-width: none; margin-top: 0; padding: 20px; border: 1px solid #dbe4ef; border-radius: 12px; background: #fff; }
header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
h3 { font-size: 16px; margin: 0 0 6px; }
p { color: #7c899c; font-size: 12px; line-height: 1.7; margin: 4px 0; }
.items { display: grid; gap: 12px; margin-top: 20px; max-width: none; }
.system-items article { background: #f4f7fb; color: #617189; overflow-wrap: anywhere; }
article { display: grid; grid-template-columns: minmax(100px, 1fr) minmax(100px, 1fr) auto; align-items: center; gap: 16px; padding: 18px; border: 1px solid #dbe4ef; border-radius: 10px; }
label { display: grid; gap: 6px; color: #75839a; font-size: 12px; }
input,select { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px; border: 1px solid #d4deeb; border-radius: 5px; font: inherit; color: #334158; background: #fafcff; }
button { cursor: pointer; border: 1px solid #bed0e5; border-radius: 6px; padding: 8px 12px; color: #315f98; background: #edf4fd; font: inherit; font-size: 12px; }
button:disabled { opacity: .4; cursor: default; }
small { grid-column: 1 / -1; color: #9b8359; }
@media (max-width: 760px) { .style-preset-section { padding: 14px; } article { grid-template-columns: minmax(0, 1fr); } }
</style>
