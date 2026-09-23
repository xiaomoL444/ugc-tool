<template>
  <label class="rgba-control" :class="{ 'is-animated': animated }" :data-animated="animated ? 'true' : undefined" :title="animated ? '此属性已加入动画；修改会在当前时间记帧' : undefined">
    <span class="rgba-label">{{ label }}<small v-if="animated" class="rgba-animation-badge">◆ 已加入动画</small></span>
    <div class="rgba-inputs">
      <input class="rgba-swatch" :value="hex" type="color" :aria-label="`${label}取色`" @input="updateHex" />
      <input class="rgba-hex" :value="hexText" :aria-label="`${label}十六进制`" maxlength="6" @input="updateHex" />
      <ScrubbableNumberInput class="rgba-alpha" :model-value="opacity" :aria-label="`${label}透明度`" :animated="animated" :min="0" :max="100" :step="1" @update:model-value="updateOpacity" />
      <i>%</i>
    </div>
  </label>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import type { ColorRGBA } from "./types";

const props = withDefaults(defineProps<{ label: string; modelValue: ColorRGBA; animated?: boolean }>(), { animated: false });
const emit = defineEmits<{ (event: "update:modelValue", value: ColorRGBA): void }>();

const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
const byteHex = (value: number) => clampByte(value).toString(16).padStart(2, "0");
const hex = computed(() => `#${byteHex(props.modelValue.r)}${byteHex(props.modelValue.g)}${byteHex(props.modelValue.b)}`);
const hexText = computed(() => hex.value.slice(1).toUpperCase());
const opacity = computed(() => Math.round(Math.min(1, Math.max(0, props.modelValue.a)) * 100));

function updateHex(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(raw)) return;
  emit("update:modelValue", {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
    a: props.modelValue.a,
  });
}

function updateOpacity(value: number | null) {
  if (value === null) return;
  emit("update:modelValue", { ...props.modelValue, a: Math.min(1, Math.max(0, value / 100)) });
}
</script>

<style scoped>
.rgba-control { display: block; margin-top: 11px; color: #c9ced8; font-size: 11px; }
.rgba-label { display: block; margin-bottom: 6px; }
.rgba-inputs {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 48px 20px;
  align-items: center;
  box-sizing: border-box;
  height: 30px;
  border: 1px solid #454b58;
  border-radius: 6px;
  background: #262b35;
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
}

.rgba-inputs:hover { border-color: #626b7e; }
.rgba-inputs:focus-within { border-color: #7195ff; box-shadow: 0 0 0 2px #527cf326; }
.rgba-inputs input {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  color: #e4e7ef !important;
  font: inherit;
  font-size: 12px !important;
  outline: none;
}

.rgba-swatch { width: 30px; padding: 4px !important; cursor: pointer; }
.rgba-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.rgba-swatch::-webkit-color-swatch { border: 1px solid #ffffff38; border-radius: 3px; }
.rgba-swatch::-moz-color-swatch { border: 1px solid #ffffff38; border-radius: 3px; }
.rgba-hex { padding: 4px 6px !important; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: .03em; }
.rgba-inputs .rgba-alpha { border-left: 1px solid #454b58 !important; padding: 4px 3px !important; text-align: right; }
.rgba-inputs i { color: #a9afbb; font-size: 10px; font-style: normal; text-align: center; }
.rgba-control.is-animated .rgba-inputs { border-color: #a66571; background: #533843; }
.rgba-control.is-animated .rgba-inputs:hover { border-color: #d58e9b; }
.rgba-control.is-animated .rgba-inputs:focus-within { border-color: #f0a3b0; box-shadow: 0 0 0 2px #d36e8530; }
.rgba-animation-badge { margin-left: 6px; padding: 1px 4px; border: 1px solid #a65f69; border-radius: 3px; color: #ffc1c8; background: #663b4638; font-size: 8px; line-height: 1.4; }
</style>
