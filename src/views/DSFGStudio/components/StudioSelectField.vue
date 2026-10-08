<script setup lang="ts" generic="T">
import { useAttrs, useSlots } from "vue";
import { NSelect, type SelectOption, type SelectGroupOption } from "naive-ui";
import { studioSelectOptions, type StudioFieldOption } from "./studioSelectOptions";
import { studioSelectTheme } from "./studioSelectTheme";
import "../studioSelect.css";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue?: T; value?: T; disabled?: boolean; placeholder?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: T]; change: [event: Event] }>();
const slots = useSlots();
const attrs = useAttrs();
const menuProps = { class: "studio-select-menu", "data-clip-editor": "" };
// Evaluate the slot during rendering so v-for/v-if options stay reactive.
function selection() {
  const rows = studioSelectOptions(slots.default?.() ?? []);
  const options: (SelectOption | SelectGroupOption)[] = [];
  for (const [index, row] of rows.entries()) {
    const option = { label: row.label, value: index, disabled: row.disabled };
    if (row.group) {
      let group = options.find(item => item.type === "group" && item.label === row.group) as SelectGroupOption | undefined;
      if (!group) { group = { type: "group", key: row.group, label: row.group, children: [] }; options.push(group); }
      (group.children ??= []).push(option);
    } else options.push(option);
  }
  const value = props.modelValue !== undefined ? props.modelValue : props.value;
  const index = rows.findIndex(row => Object.is(row.value, value));
  return { rows, options, value: index < 0 ? null : index };
}
function update(index: number, rows: StudioFieldOption[]) {
  const row = rows[index];
  if (props.disabled || !row || row.disabled) return;
  emit("update:modelValue", row.value as T);
  // Preserve existing @change handlers while v-model receives the original typed value.
  const event = new Event("change");
  const target = { value: String(row.value ?? ""), selectedIndex: index };
  Object.defineProperties(event, { target: { value: target }, currentTarget: { value: target } });
  emit("change", event);
}
</script>

<template>
  <template v-for="state in [selection()]" :key="0">
    <NSelect v-bind="attrs" class="studio-select-field nodrag nopan" :value="state.value" :options="state.options"
      :aria-label="String(attrs['aria-label'] ?? placeholder ?? '选择选项')" :disabled="disabled" :placeholder="placeholder ?? '请选择'"
      :theme-overrides="studioSelectTheme" :menu-props="menuProps" :consistent-menu-width="false"
      @update:value="update($event, state.rows)" />
  </template>
</template>
