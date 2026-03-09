<template>
    <div class="param_type"
        :style="{ '--bg-color': getTypeNameMap()[param_type].background, '--color': getTypeNameMap()[param_type].color }">
        {{ getTypeNameMap()[param_type].title }}:
    </div>
</template>

<style scoped>
.param_type {
    padding: 0.2rem 0.5rem;
    background: #f0f0f0;
    /* border: 1px solid #ccc; */
    border-radius: 0.5rem;
    background-color: var(--bg-color, #ccc);
    color: var(--color, #FFF);
    font-weight: 550;
    white-space: nowrap;
    /* 阻止换行 */
}
</style>

<script setup>
import { getTypeNameMap } from '../utils/typeMap';

const props = defineProps({
    param_type: { type: String, request: true }
});
</script>