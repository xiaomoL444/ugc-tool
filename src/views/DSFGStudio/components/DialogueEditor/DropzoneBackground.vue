<script lang="ts" setup>
import { Background } from '@vue-flow/background'
</script>

<template>
  <div class="dropzone-background">
    <Background :size="1" :gap="20" pattern-color="#cbd7e6" />

    <div class="overlay">
      <slot />
    </div>
  </div>
</template>
