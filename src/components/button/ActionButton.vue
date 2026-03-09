<script setup>
import BaseButton from '../UI/BaseButton.vue';

const emit = defineEmits(['update:selected'])

function onClick() {
    emit('update:selected')
}

// 判断是否选中
</script>

<template>
    <BaseButton class="ListButton" :activeEffect="false"
        bgGradient="#8eb1ff"
        @click="onClick">
        <slot />
    </BaseButton>
</template>

<style scoped>
.ListButton {
    width: 100%;
}
</style>
