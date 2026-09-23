<template>
  <div class="gia-export-backdrop" @pointerdown.self.stop="emit('close')">
    <section ref="dialog" class="gia-export-dialog" role="dialog" aria-modal="true" aria-label="导出客户端控件 UI" tabindex="-1" @pointerdown.stop @keydown.esc.stop.prevent="emit('close')">
      <header><h2>导出客户端控件 UI</h2><button type="button" aria-label="关闭 GIA 导出" @click="emit('close')">×</button></header>
      <p>导出当前控件树的 {{ count }} 个控件及基础参数。Timeline 动画仍通过 Lua 工具导出。</p>
      <p>模板引用按索引保存，对应模板需已存在于游戏工程中。</p>
      <p>导出时控件内部 ID 按列表顺序重新连续编号，并同步更新层级引用；图片素材 ID 和模板索引保持不变。</p>
      <p>图元控件导出为空容器，隐藏状态和手柄聚焦由配套图元 Lua 数据及 PrimitiveImageLib 恢复。</p>
      <form @submit.prevent="emit('export', { name: name.trim(), uiIndex: Number(index) })">
        <label>名称<input v-model="name" aria-label="GIA 名称" required /></label>
        <label>客户端 UI 索引<input v-model="index" aria-label="客户端 UI 索引" type="number" min="0" max="2147483647" step="1" required /></label>
        <p>{{ hasSource ? '已保留原始 GIA；未修改的组件和其他设备布局将保留。布局修改写入当前预览设备。' : '新建控件使用当前基础布局。旧工程如曾导入 GIA，请先补充原始文件以保留完整组件数据。' }}</p>
        <button type="button" :disabled="busy" @click="fileInput?.click()">{{ hasSource ? '更换原始 GIA' : '补充原始 GIA' }}</button>
        <input ref="fileInput" class="hidden-input" type="file" accept=".gia" @change="loadSource" />
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <footer><button type="button" @click="emit('close')">取消</button><button class="primary" :disabled="busy || !name.trim()" type="submit">{{ busy ? '正在处理…' : '校验并导出 GIA' }}</button></footer>
      </form>
    </section>
  </div>
</template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
const props = defineProps<{ projectName: string; initialIndex: number; count: number; hasSource: boolean; busy: boolean; error: string; notice: string }>();
const emit = defineEmits<{ (event: "close"): void; (event: "export", options: { name: string; uiIndex: number }): void; (event: "source", file: File): void }>();
const name = ref(props.projectName), index = ref<number | string>(props.initialIndex), fileInput = ref<HTMLInputElement | null>(null), dialog = ref<HTMLElement | null>(null);
watch(() => props.initialIndex, value => { index.value = value; });
let previousFocus: HTMLElement | null = null;
onMounted(() => { previousFocus = document.activeElement as HTMLElement | null; dialog.value?.focus(); });
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
function loadSource(event: Event) { const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ""; if (file) emit("source", file); }
</script>
<style scoped>
.gia-export-backdrop { position: absolute; inset: 0; z-index: 240; background: #10141cb0; display: flex; align-items: center; justify-content: center; }
.gia-export-dialog { width: min(500px, calc(100% - 40px)); max-height: 85%; overflow: auto; padding: 22px; border: 1px solid #56627a; border-radius: 10px; background: #292f3c; color: #e4eaf5; box-shadow: 0 16px 50px #0006; outline: none; font-size: 12px; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; } h2 { margin: 0; font-size: 17px; }
p { color: #aebad0; line-height: 1.7; margin: 12px 0; } label { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 14px 0; }
input { min-width: 0; width: 65%; box-sizing: border-box; } input, button { border: 1px solid #505e78; border-radius: 5px; background: #333e51; color: inherit; padding: 7px 10px; font: inherit; }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } button:hover { background: #465776; } .primary { background: #426bc5; } footer { justify-content: flex-end; margin-top: 20px; }
.hidden-input { display: none; } .error { color: #ffadaf; white-space: pre-wrap; } .notice { color: #a4d5b5; }
</style>
