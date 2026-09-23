<template>
  <aside class="animation-list-panel" :class="{ 'is-collapsed': collapsed }" aria-label="Animator 动画列表">
    <header><div v-show="!collapsed"><b>Animations</b><small>Animator · {{ animations.length }} 个动画</small></div><div class="panel-tools"><button v-show="!collapsed" :disabled="disabled" aria-label="新建 Animation" title="新建空白动画" @click="emit('create')">＋</button><button class="collapse-button" :aria-label="collapsed ? '展开动画面板' : '收起动画面板'" :title="collapsed ? '展开动画面板' : '收起动画面板'" :aria-expanded="!collapsed" @click="emit('toggle-collapse')">{{ collapsed ? '‹' : '›' }}</button></div></header>
    <div v-if="collapsed" class="collapsed-caption" :title="selected?.name"><b>Animations</b><span>{{ selected?.name }}</span></div>
    <div v-show="!collapsed" class="animation-list" role="listbox" aria-label="选择 Animation">
      <button v-for="animation in animations" :key="animation.id" role="option" :aria-selected="animation.id === selectedId" :disabled="disabled" :class="{ selected: animation.id === selectedId }" :title="animation.name" @click="emit('select', animation.id)">
        <span class="animation-diamond">◇</span><span class="animation-name"><b>{{ animation.name }}</b><small>{{ animation.duration }} s · {{ animation.keyframeTracks.length }} 条轨道</small></span>
      </button>
    </div>
    <footer v-if="selected" v-show="!collapsed">
      <label>动画名称<input :key="selectedId" v-model="draftName" :disabled="disabled" maxlength="80" aria-label="Animation 名称" @change="rename" @keydown.enter.prevent="rename" /></label>
      <div class="animation-actions"><button :disabled="disabled" @click="emit('duplicate')">复制动画</button><button :disabled="disabled || animations.length <= 1" title="至少保留一个动画" @click="pendingDelete = selectedId">删除</button></div>
      <div v-if="pendingDelete === selectedId" class="delete-confirm" role="alertdialog" aria-label="确认删除 Animation"><p>删除「{{ selected.name }}」及其关键帧？控件不会删除，可撤销。</p><button @click="pendingDelete = null">取消</button><button class="danger" @click="emit('remove', selectedId); pendingDelete = null">确认删除</button></div>
      <p v-if="notice" class="animation-notice" role="status">{{ notice }}</p>
      <p class="animation-help">共用控件层级与基础参数。<br />关键帧、时长及 Lua Data 对应当前动画。</p>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { UIAnimation } from "./types";
const props = defineProps<{ animations: UIAnimation[]; selectedId: string; disabled?: boolean; notice?: string; collapsed?: boolean }>();
const emit = defineEmits<{ (event: "select" | "remove", id: string): void; (event: "create" | "duplicate" | "toggle-collapse"): void; (event: "rename", name: string): void }>();
const selected = computed(() => props.animations.find(animation => animation.id === props.selectedId));
const draftName = ref("");
const pendingDelete = ref<string | null>(null);
watch(() => [props.selectedId, selected.value?.name], () => { draftName.value = selected.value?.name ?? ""; pendingDelete.value = null; }, { immediate: true });
async function rename() { emit("rename", draftName.value); await nextTick(); draftName.value = selected.value?.name ?? ""; }
</script>

<style scoped>
.animation-list-panel { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: #292e38; color: #cbd1dc; border-left: 1px solid #424a58; font-size: 11px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 12px 10px; border-bottom: 1px solid #414855; }
header b { color: #edf1f8; font-size: 12px; } header small { display: block; color: #8793a6; margin-top: 4px; }
.panel-tools { display: flex; gap: 4px; flex-shrink: 0; }
.panel-tools button { width: 24px; height: 26px; padding: 0; }
.is-collapsed header { padding: 8px 3px; justify-content: center; }
.collapsed-caption { display: flex; align-items: center; gap: 14px; writing-mode: vertical-rl; padding: 12px 7px; overflow: hidden; color: #aab8ce; }
.collapsed-caption span { max-height: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #8293ad; }
button { border: 1px solid #495363; background: #343b49; color: #dce3ed; border-radius: 4px; cursor: pointer; padding: 5px 8px; font: inherit; }
button:hover { background: #414d60; } button:disabled { opacity: .35; cursor: default; }
button:focus-visible, input:focus-visible { outline: 1px solid #8eb2fa; outline-offset: -1px; }
.animation-list { flex: 1; min-height: 50px; overflow-y: auto; padding: 5px; }
.animation-list button { width: 100%; display: flex; align-items: center; text-align: left; gap: 7px; margin-bottom: 3px; border-color: transparent; background: transparent; padding: 9px 6px; }
.animation-list button.selected { background: #3c527d; border-color: #577ac0; }
.animation-name { min-width: 0; } .animation-name b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; } .animation-name small { display: block; font-size: 10px; color: #96a8c4; margin-top: 4px; }
.animation-diamond { color: #d5a6a9; font-size: 18px; }
footer { border-top: 1px solid #414855; padding: 10px; overflow-y: auto; max-height: 65%; }
label { display: block; color: #a5afbf; } input { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 6px; border: 1px solid #414b5c; border-radius: 4px; background: #202530; color: #edf1fa; font: inherit; }
.animation-actions { display: flex; gap: 5px; margin-top: 8px; } .animation-actions button:first-child { flex: 1; }
.animation-help { color: #8591a4; font-size: 10px; line-height: 1.6; margin: 10px 0 0; }
.animation-notice, .delete-confirm { color: #efb8bd; line-height: 1.5; } .delete-confirm button { margin-right: 4px; } .danger { background: #733e48; }
</style>
