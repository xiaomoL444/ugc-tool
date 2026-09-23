<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ImageAssetLibrary from "@/views/ClientUIAnimationEditor/ImageAssetLibrary.vue";
import { selectIconCatalog, selectOptionIconUrl } from "../utils/selectOptionIcons";

const props = withDefaults(defineProps<{ modelValue: number; label?: string }>(), { label: "选项图标" });
const emit = defineEmits<{ "update:modelValue": [id: number] }>();
const open = ref(false);
const failed = ref(false);
const src = computed(() => selectOptionIconUrl(props.modelValue));
watch(src, () => { failed.value = false; });
function select(id: number | null) {
  emit("update:modelValue", id ?? 0);
  open.value = false;
}
function editId(event: Event) {
  const input = event.target as HTMLInputElement;
  const id = input.valueAsNumber;
  if (Number.isInteger(id) && id >= 0 && id <= 2147483647) emit("update:modelValue", id);
  else input.value = String(props.modelValue);
}
</script>

<template>
  <span class="select-option-icon">
    <button type="button" class="icon-picker" :aria-label="`选择${label}`" :title="`${label}：${modelValue} · 点击选择图片`" @click="failed = false; open = true">
      <img v-if="src && !failed" :src="src" alt="" loading="lazy" @error="failed = true" />
      <span v-else aria-hidden="true">{{ modelValue === 0 ? '—' : '▧' }}</span>
    </button>
    <input type="number" class="icon-id" :aria-label="`${label} ID`" title="图标 ID，也可点击图片选择" :value="modelValue" min="0" max="2147483647" step="1" @change="editId" />
    <Teleport to="body">
      <div v-if="open" class="option-icon-backdrop dsfg-typography" @click.self="open = false" @pointerdown.stop @keydown.stop>
        <ImageAssetLibrary class="option-icon-library" :catalog="selectIconCatalog" :load-metadata="false" :selected-id="modelValue || null" @select="select" @close="open = false" />
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.select-option-icon { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; }
.icon-picker { display: grid; place-items: center; width: 30px; height: 30px; padding: 3px; border: 1px solid #8191a566; border-radius: 5px; background: #566578; color: #e3eaf4; cursor: pointer; }
.icon-picker:hover { border-color: #72a3e6; background: #43536b; }
.icon-picker img { width: 100%; height: 100%; object-fit: contain; }
.icon-id { box-sizing: border-box; width: 65px; min-width: 0; padding: 3px; border: 1px solid #8191a544; border-radius: 4px; background: transparent; color: inherit; font-family: inherit; font-size: 10px; appearance: textfield; -moz-appearance: textfield; }
.icon-id::-webkit-inner-spin-button, .icon-id::-webkit-outer-spin-button { appearance: none; margin: 0; }
.option-icon-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 20px; background: #0b152b77; }
.option-icon-library { position: relative; inset: auto; width: min(960px, 100%); height: min(620px, calc(100dvh - 40px)); min-height: 0; border: 1px solid #606779; border-radius: 10px; overflow: hidden; }
@media (max-width: 600px) { .option-icon-backdrop { padding: 8px; } .option-icon-library { height: calc(100dvh - 16px); } .option-icon-library :deep(nav) { flex-basis: 100px; } }
</style>
