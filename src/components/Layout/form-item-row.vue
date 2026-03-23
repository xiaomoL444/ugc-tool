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
  position: relative;
  display: flex;
  flex-direction: row;
  padding: 2px;
  gap: 5px;
  height: auto;
}
.title {
    position: relative;
  flex-shrink: 0;
  height: 100%;
}
.content {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height:auto;
  flex: 1;
}
</style>
