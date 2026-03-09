<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
    disabled: { type: Boolean, default: false },
    highlight: { type: Boolean, default: false },
    activeEffect: { type: Boolean, default: true },

    // 支持渐变色
    bgColor: { type: String, default: '#f6f7f9' },
    hoverColor: { type: String, default: '#e0e0e0' },
    activeColor: { type: String, default: '#c0c0ff' },
    borderColor: { type: String, default: '#ccc' },
    bgGradient: { type: String, default: '' } // e.g. "linear-gradient(90deg,#ff7a18,#af002d)"
})

const emit = defineEmits(['click'])
const isPressed = ref(false)

// 计算按钮背景
const buttonStyle = computed(() => ({
    background: props.disabled
        ? '#f0f0f0'
        : isPressed.value && props.activeEffect
            ? props.activeColor
            : props.bgGradient || props.bgColor, // 优先使用渐变
    borderColor: props.borderColor
}))

function onMouseDown() { if (!props.disabled && props.activeEffect) isPressed.value = true }
function onMouseUp() { if (!props.disabled && props.activeEffect) isPressed.value = false }
function onClick(event) { if (!props.disabled) emit('click', event) }
</script>

<template>
    <button :style="buttonStyle" class="base-button" @mousedown="onMouseDown" @mouseup="onMouseUp"
        @mouseleave="onMouseUp" @click="onClick">
        <slot />
    </button>
</template>

<style scoped>
.base-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 16px;
    border-radius: 8px;
    border: 1px solid;
    border: 0;
    cursor: pointer;
    min-height: 36px;
    transition: all 0.15s;


      /* 核心：模糊背景背后的内容 */
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);

  /* 半透明背景，建议使用带有微弱蓝紫色的白色 */
  background: rgba(255, 255, 255, 0.5);

  /* 柔和的阴影增强悬浮感 */
  filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.1));
  overflow: hidden; /* 关键：保证内部背景跟着圆角裁切 */
}

.base-button:hover {
    filter: brightness(1.1);
    /* 悬停轻微变亮，不必固定颜色 */
}

.base-button:disabled {
    background-color: #f0f0f0 !important;
    color: #999;
    cursor: not-allowed;
}
</style>
