<script setup lang="ts">
import { computed, ref, watch, watchEffect } from "vue";
import type { PublicEventParamType } from "./EntityPresetEditor/publicEventPresets";
import { getTypedValueError, isTypedValueDraft } from "./typedValueInput";

const props = withDefaults(defineProps<{ modelValue?: string; valueType: PublicEventParamType }>(), { modelValue: "" });
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const input = ref<HTMLInputElement>();
const composing = ref(false);
const checked = ref(false);
const acceptedValue = ref(props.modelValue);
watch(() => props.modelValue, value => { acceptedValue.value = value; }, { flush: "sync" });
const error = computed(() => checked.value ? getTypedValueError(props.valueType, acceptedValue.value) : "");
watchEffect(() => { input.value?.setCustomValidity?.(error.value); }, { flush: "post" });

function updateValue(event: Event) {
  if (composing.value || (event as InputEvent).isComposing) return;
  const element = event.target as HTMLInputElement;
  if (!isTypedValueDraft(props.valueType, element.value)) {
    element.value = acceptedValue.value;
    return;
  }
  if (element.value !== acceptedValue.value) {
    acceptedValue.value = element.value;
    emit("update:modelValue", element.value);
  }
}

function beforeInput(event: InputEvent) {
  if (props.valueType === "String" || composing.value || event.isComposing || !event.cancelable
      || !event.inputType.startsWith("insert") || event.data === null) return;
  const element = event.target as HTMLInputElement;
  if (element.selectionStart === null || element.selectionEnd === null) return;
  const next = element.value.slice(0, element.selectionStart) + event.data + element.value.slice(element.selectionEnd);
  if (!isTypedValueDraft(props.valueType, next)) event.preventDefault();
}

function compositionEnd(event: CompositionEvent) {
  composing.value = false;
  updateValue(event);
}
</script>

<template>
  <input ref="input" :value="modelValue" type="text"
    :inputmode="valueType === 'String' ? 'text' : valueType === 'Float' ? 'decimal' : 'numeric'"
    :aria-invalid="error ? 'true' : undefined" :title="error || undefined"
    @beforeinput="beforeInput" @input="updateValue" @focus="checked = false" @blur="checked = true"
    @compositionstart="composing = true" @compositionend="compositionEnd" />
</template>

<style scoped>
input[aria-invalid="true"] { border-color: #c65058; outline-color: #c65058; }
</style>
