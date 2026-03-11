<template>
  <div class="container">
    <div class="name" @dblclick="doubleClick" :hidden="isInput">
      <NEllipsis> {{ name }}</NEllipsis>
    </div>
    <input
      ref="inputRef"
      :value="name"
      :hidden="!isInput"
      @Change="finishInput"
      @blur="finishInput"
      @keydown.prevent.enter="finishInput"
    />
    <div class="id" :hidden="id == null">
      {{ id }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { NEllipsis } from "naive-ui";
import { nextTick, ref } from "vue";

const props = defineProps({
  name: { type: String, required: true, default: "StructName " },
  id: { type: String, required: false },
  enableDoubleClick: { type: Boolean, required: false, default: true },
});

const emit = defineEmits(["update:input"]);

function onClick() {}

const isInput = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
function doubleClick() {
  if (!props.enableDoubleClick) {
    return;
  }
  isInput.value = true;
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
}

function finishInput(e: Event) {
  if (isInput.value) {
    emit("update:input", (e.target as HTMLInputElement).value);
  }
  isInput.value = false;
}
</script>

<style scoped>
.container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  /* 上 → 下 */
  align-items: flex-start;
  /* 左对齐 */
  gap: 0.1rem;
}

.name {
  font-size: 1.1rem;
  text-align: left;
  width: 100%;
}

.id {
  font-size: 0.8rem;
}
</style>
