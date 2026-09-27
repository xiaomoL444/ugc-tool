<template>
  <label class="number-field"><span>{{ label }}</span><div><input type="number" :aria-label="label" :value="modelValue" :min="min" :max="max" :step="step" @change="change" /><small v-if="unit">{{ unit }}</small></div></label>
</template>
<script setup lang="ts">
const props = withDefaults(defineProps<{ label: string; modelValue: number; min?: number; max?: number; step?: number; unit?: string }>(), { min: -5000, max: 5000, step: 1, unit: '' });
const emit = defineEmits<{ (event: 'update:modelValue', value: number): void }>();
function change(event: Event) { const input = event.target as HTMLInputElement; const n = input.value.trim() === '' ? NaN : Number(input.value); const value = Number.isFinite(n) ? Math.max(props.min, Math.min(props.max, props.step === 1 ? Math.round(n) : n)) : props.modelValue; input.value = String(value); emit('update:modelValue', value); }
</script>
<style scoped>
.number-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:11px;color:#9ba8bf}.number-field>div{display:flex;align-items:center;border:1px solid #354159;background:#151c29;border-radius:5px;overflow:hidden}.number-field>div:focus-within{border-color:#96aaff}.number-field input{width:100%;min-width:0;height:29px;padding:0 8px;border:0;background:transparent;outline:none;color:#e3e9f5;font:inherit;font-size:12px;font-variant-numeric:tabular-nums;box-sizing:border-box}.number-field small{font-size:10px;padding-right:8px;white-space:nowrap;color:#72809b}
</style>


