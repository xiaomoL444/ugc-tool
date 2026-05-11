<template>
    <div class="container">
        <div class="icon" v-on:click="Clipboard(info)">
            <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">
                <path
                    d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                    fill="currentColor"></path>
            </svg>
        </div>
        <div class="content">{{ title }}:{{ info }}</div>
    </div>
</template>

<style scoped>
.container {
    display: flex;
    flex-direction: row;
    gap: 20px;
}

.content {
    font-size: 1.2rem;
}

.icon {
    height: 30px;
    width: 30px;
    background-color: #FFFFFFCC;
    border-radius: 10px;
    padding: 5px;
}
</style>
<script setup lang="ts">
import { Clipboard } from '@/utils/clipboard';

defineProps<{ info: string; title: string }>();
</script>