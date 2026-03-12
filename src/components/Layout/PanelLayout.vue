<template>
  <div class="container">
    <slot />
  </div>
</template>

<style scoped>
.container {
  width: 100%;

  border-top: 1px solid rgba(255, 255, 255, 0.45);
  border-left: 1px solid rgba(255, 255, 255, 0.35);
  border-right: 1px solid rgba(255, 255, 255, 0.25);
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);

  background: rgba(255, 255, 255, 0.1); /* 半透明底色 */

  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px); /* Safari */
  border-radius: 12px;

  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3),
    0 4px 12px rgba(0, 0, 0, 0.04);
    overflow: hidden;
}
</style>

<script lang="ts"></script>
