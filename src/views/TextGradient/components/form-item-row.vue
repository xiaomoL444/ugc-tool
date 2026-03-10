<template>
  <div class="container">
    <div class="title">{{ title }}</div>
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({ title: String });
</script>

<style scoped>
.container {
  display: flex;
  flex-direction: row;
  padding: 2px;
  gap: 5px;
}
.title {
  flex-shrink: 0;
}
.content {
  width: 100%;
  height: auto;
  flex: 1;
}
</style>
