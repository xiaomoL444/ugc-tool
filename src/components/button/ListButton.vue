<script setup>
import BaseButton from '../UI/BaseButton.vue';


const props = defineProps({
    isSelected: { type: Boolean, required: true }
})

const emit = defineEmits(['update:selected'])

function onClick() {
    emit('update:selected')
}

// 判断是否选中
</script>

<template>
    <BaseButton class="ListButton" :highlight="isSelected"
        :bgGradient="isSelected ? '#01BDFE60' : '#FFF7'" @click="onClick">
        <slot />
    </BaseButton>
</template>

<style scoped>
.ListButton {
    width: 100%;
}
</style>
