<script setup lang="ts">
import ListButton from "@/components/button/ListButton.vue";
import StructItem from "./StructItem.vue";
import ActionButton from "@/components/button/ActionButton.vue";

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "select", value: string): void;
  (e: "delete"): void;
  (e: "add"): void;
}>();

const props = defineProps<{
  values: string[];
  selectedValue: string;
}>();
</script>
<template>
  <div class="actionButtonComponent">
    <ActionButton v-on:update:selected="emit('delete')" class="delete"
      >删除</ActionButton
    >
    <ActionButton v-on:update:selected="emit('add')" class="add">
      <img
        width="20"
        height="20"
        src="https://img.icons8.com/parakeet-filled/100/plus-math.png"
        alt="plus-math"
      />
    </ActionButton>
  </div>

  <div class="selectableListPlane">
    <ListButton
      v-for="(id, index) in values"
      :key="index"
      :is-selected="id == selectedValue"
      v-on:update:selected="emit('select', id)"
    >
      <StructItem :name="id" v-on:update:input="" />
    </ListButton>
  </div>
</template>
