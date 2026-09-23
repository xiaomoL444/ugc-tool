<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import { downloadTextFile } from "@/utils/download";
import EditorKindSelect from "../EditorKindSelect.vue";
import { useSceneProject } from "./useSceneProject";
import { nextSceneId, contactWorldOptions, updateSceneWorldId, validateSceneProject, type SceneWorld, type SceneMainArea, type SceneSubArea } from "./sceneProject";
import { exportScene } from "./sceneExporter";
withDefaults(defineProps<{ editorKind?: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene" }>(), { editorKind: "Scene" });
const emit = defineEmits<{ "update:editorKind": [value: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene"] }>();
const { project, busy, error, status, retry, prepareToLeave } = useSceneProject();
defineExpose({ prepareToLeave });
const selected = ref<{ kind: "world" | "main" | "sub"; index: number }>({ kind: "world", index: 0 });
const settings = ref(false);
const search = ref("");
const world = computed(() => selected.value.kind === "world" ? project.value?.worlds[selected.value.index] : undefined);
const main = computed(() => selected.value.kind === "main" ? project.value?.mainAreas[selected.value.index] : undefined);
const sub = computed(() => selected.value.kind === "sub" ? project.value?.subAreas[selected.value.index] : undefined);
const idDraft = ref("");
watch(() => world.value ?? main.value ?? sub.value, item => { idDraft.value = item?.id ?? ""; }, { immediate: true });
const issues = computed(() => project.value ? validateSceneProject(project.value) : []);
const structLabels = { scene: "场景配置数据", world: "世界", mainArea: "一级区域", subArea: "二级区域", subAreaTable: "二级区域字典" };
function matches(item: { id: string; name: string }) { return `${item.id} ${item.name}`.toLowerCase().includes(search.value.trim().toLowerCase()); }
function showMain(item: SceneMainArea) { return matches(item) || !!project.value?.subAreas.some(child => child.mainAreaId === item.id && matches(child)); }
function showWorld(item: SceneWorld) { return matches(item) || !!project.value?.mainAreas.some(child => child.worldId === item.id && showMain(child)); }
function choose(kind: "world" | "main" | "sub", index: number) { selected.value = { kind, index }; settings.value = false; }
function addWorld() {
  if (!project.value) return;
  project.value.worlds.push({ id: nextSceneId(project.value.worlds), name: "新世界", contacts: [] });
  choose("world", project.value.worlds.length - 1);
}
function addMain(parent: SceneWorld) {
  if (!project.value) return;
  project.value.mainAreas.push({ id: nextSceneId(project.value.mainAreas), name: "新一级区域", worldId: parent.id });
  choose("main", project.value.mainAreas.length - 1);
}
function addSub(parent: SceneMainArea) {
  if (!project.value) return;
  project.value.subAreas.push({ id: nextSceneId(project.value.subAreas), name: "新二级区域", mainAreaId: parent.id, bgm: "0" });
  choose("sub", project.value.subAreas.length - 1);
}
function addContact(source: SceneWorld) {
  if (!project.value) return;
  const target = contactWorldOptions(project.value, source)[0];
  if (target) source.contacts.push({ key: target.id, x: "0", y: "0", z: "0" });
}
function changeId(item: SceneWorld | SceneMainArea | SceneSubArea, event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.value.trim();
  const rows = selected.value.kind === "world" ? project.value!.worlds : selected.value.kind === "main" ? project.value!.mainAreas : project.value!.subAreas;
  if (!/^\d+$/.test(value) || Number(value) > 2147483647 || rows.some(row => row !== item && Number(row.id) === Number(value))) {
    idDraft.value = item.id; input.value = item.id; toast.error("ID 必须为同类中不重复的非负 Int32 整数"); return;
  }
  const old = item.id, next = String(Number(value));
  if (selected.value.kind === "world") updateSceneWorldId(project.value!, item as SceneWorld, next);
  else item.id = next;
  idDraft.value = next;
  if (selected.value.kind === "main") project.value!.subAreas.filter(row => row.mainAreaId === old).forEach(row => { row.mainAreaId = next; });
}
function removeSelected() {
  const p = project.value; if (!p) return;
  if (world.value) {
    if (p.worlds.some(source => source !== world.value && source.contacts.some(point => Number(point.key) === Number(world.value!.id)))) { toast.warning("请先移除其他世界中关联该世界的连接点"); return; }
    if (p.mainAreas.some(row => row.worldId === world.value!.id)) { toast.warning("请先移动或删除该世界下的一级区域"); return; }
    if (!confirm(`删除世界「${world.value.name}」？`)) return;
    p.worlds.splice(selected.value.index, 1);
  } else if (main.value) {
    if (p.subAreas.some(row => row.mainAreaId === main.value!.id)) { toast.warning("请先移动或删除该一级区域下的二级区域"); return; }
    if (!confirm(`删除一级区域「${main.value.name}」？`)) return;
    p.mainAreas.splice(selected.value.index, 1);
  } else if (sub.value) {
    if (!confirm(`删除二级区域「${sub.value.name}」？`)) return;
    p.subAreas.splice(selected.value.index, 1);
  }
  choose("world", 0);
}
function exportVariables() {
  if (!project.value) return;
  try { downloadTextFile(exportScene(project.value).json, "NOLOC_场景配置数据.json", "application/json"); toast.success("场景数据已导出"); }
  catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); }
}
</script>

<template>
  <div class="scene-editor">
    <aside>
      <EditorKindSelect :model-value="editorKind" @update:model-value="emit('update:editorKind', $event)" />
      <div class="tree-heading"><strong>场景层级</strong><button :disabled="!project || busy" @click="addWorld">＋ 世界</button></div>
      <input v-model="search" class="search" placeholder="搜索区域名称或 ID" aria-label="搜索场景区域" />
      <nav v-if="project" aria-label="场景层级">
        <template v-for="(item, index) in project.worlds" :key="index">
          <div v-if="showWorld(item)" class="tree-world">
            <button class="tree-node" :class="{ active: world === item && !settings }" @click="choose('world', index)">世界 · {{ item.name || '未命名' }} <small>{{ item.id }}</small></button>
            <template v-for="(area, areaIndex) in project.mainAreas" :key="areaIndex">
              <div v-if="area.worldId === item.id && (matches(item) || showMain(area))" class="tree-main">
                <button class="tree-node" :class="{ active: main === area && !settings }" @click="choose('main', areaIndex)">一级 · {{ area.name || '未命名' }} <small>{{ area.id }}</small></button>
                <template v-for="(child, childIndex) in project.subAreas" :key="childIndex">
                  <button v-if="child.mainAreaId === area.id && (matches(item) || matches(area) || matches(child))" class="tree-node tree-sub" :class="{ active: sub === child && !settings }" @click="choose('sub', childIndex)">二级 · {{ child.name || '未命名' }} <small>{{ child.id }}</small></button>
                </template>
              </div>
            </template>
          </div>
        </template>
        <template v-for="(area, index) in project.mainAreas" :key="`orphan-main-${index}`"><button v-if="!project.worlds.some(row => row.id === area.worldId)" class="tree-node" @click="choose('main', index)">未关联一级 · {{ area.name }}</button></template>
        <template v-for="(area, index) in project.subAreas" :key="`orphan-sub-${index}`"><button v-if="!project.mainAreas.some(row => row.id === area.mainAreaId)" class="tree-node" @click="choose('sub', index)">未关联二级 · {{ area.name }}</button></template>
      </nav>
      <p class="aside-note">每个工作区固定一个场景，统一管理世界与区域。</p>
    </aside>
    <main>
      <header><div><h2>场景编辑</h2><span role="status">{{ status }}</span></div><div class="actions"><button :disabled="!project" @click="settings = !settings">结构体设置</button><button class="primary" :disabled="!project || busy || !!issues.length" @click="exportVariables">导出场景数据</button></div></header>
      <p v-if="error" class="error" role="alert">{{ error }} <button :disabled="busy" @click="retry().catch(() => undefined)">重试</button></p>
      <div v-if="issues.length" class="error" role="alert"><p v-for="issue in issues" :key="issue">{{ issue }}</p></div>
      <section v-if="project && settings" class="card"><h3>导出结构体 ID</h3><label v-for="(label, key) in structLabels" :key="key">{{ label }}<input v-model="project.structIds[key]" inputmode="numeric" /></label></section>
      <section v-else-if="project && (world || main || sub)" class="card">
        <div class="card-heading"><h3>{{ world ? '世界' : main ? '一级区域' : '二级区域' }}</h3><div class="actions"><button v-if="world" @click="addMain(world)">＋ 一级区域</button><button v-if="main" @click="addSub(main)">＋ 二级区域</button><button class="danger" @click="removeSelected">删除当前项</button></div></div>
        <template v-if="world">
          <label>世界 ID<input v-model="idDraft" inputmode="numeric" @blur="changeId(world, $event)" @keydown.enter="changeId(world, $event)" /></label>
          <label>世界名称<input v-model="world.name" /></label>
          <div class="card-heading"><h4>世界连接点（contact）</h4><button :disabled="!contactWorldOptions(project, world).length" @click="addContact(world)">＋ 关联世界</button></div>
          <p class="hint">选择关联的目标世界，并配置对应点位坐标。每个目标世界只能关联一次。</p>
          <div v-for="(point, index) in world.contacts" :key="index" class="contact-row"><label>目标世界<select v-model="point.key"><option v-if="!contactWorldOptions(project, world, point.key).some(target => target.id === point.key)" :value="point.key" disabled>无效关联 · {{ point.key }}</option><option v-for="target in contactWorldOptions(project, world, point.key)" :key="target.id" :value="target.id">{{ target.name }} · {{ target.id }}</option></select></label><label>X<input v-model="point.x" inputmode="decimal" /></label><label>Y<input v-model="point.y" inputmode="decimal" /></label><label>Z<input v-model="point.z" inputmode="decimal" /></label><button class="danger" @click="world.contacts.splice(index, 1)">删除</button></div>
          <p v-if="!world.contacts.length" class="hint">暂无关联世界。请先创建其他世界，再添加连接点。</p>
        </template>
        <template v-if="main">
          <label>一级区域 ID<input v-model="idDraft" inputmode="numeric" @blur="changeId(main, $event)" @keydown.enter="changeId(main, $event)" /></label>
          <label>区域名称<input v-model="main.name" /></label>
          <label>所属世界<select v-model="main.worldId"><option v-for="item in project.worlds" :key="item.id" :value="item.id">{{ item.name }} · {{ item.id }}</option></select></label>
        </template>
        <template v-if="sub">
          <label>二级区域 ID<input v-model="idDraft" inputmode="numeric" @blur="changeId(sub, $event)" @keydown.enter="changeId(sub, $event)" /></label>
          <label>区域名称<input v-model="sub.name" /></label>
          <label>所属一级区域<select v-model="sub.mainAreaId"><option v-for="item in project.mainAreas" :key="item.id" :value="item.id">{{ project.worlds.find(row => row.id === item.worldId)?.name }} / {{ item.name }} · {{ item.id }}</option></select></label>
          <label>BGM（整数）<input v-model="sub.bgm" inputmode="numeric" /></label>
        </template>
      </section>
      <p v-else-if="project" class="hint">从左侧选择区域，或添加一个世界。</p>
    </main>
  </div>
</template>

<style scoped>
.scene-editor { display:flex; height:100%; min-height:0; background:#f4f7fb; color:#334155; }
aside { width:270px; flex-shrink:0; border-right:1px solid #dbe3ef; overflow:auto; background:#f9fbfe; }
main { flex:1; min-width:0; overflow:auto; padding:24px; }
header,.card-heading,.tree-heading,.actions { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
header { margin-bottom:22px; } h2 { margin:0 0 6px; font-size:20px; } h3,h4 { margin:0; } header span,.hint,.aside-note { color:#7c899c; font-size:12px; line-height:1.7; }
.tree-heading { padding:18px 12px 8px; } .search { width:calc(100% - 24px); margin:8px 12px; } .aside-note { padding:12px; }
.tree-node { display:block; width:100%; text-align:left; border:0; background:transparent; overflow-wrap:anywhere; white-space:normal; } .tree-node.active { background:#deebff; color:#245baa; } .tree-main { margin-left:14px; border-left:1px solid #dbe3ef; } .tree-sub { padding-left:22px; } small { color:#8b98a9; }
.card { display:grid; gap:18px; max-width:1000px; padding:24px; border:1px solid #dbe3ef; border-radius:12px; background:white; }
label { display:grid; gap:7px; font-size:13px; color:#64748b; } input,select { box-sizing:border-box; min-width:0; padding:9px 10px; border:1px solid #cdd8e8; border-radius:6px; color:#334155; background:#fafcff; font:inherit; } input:focus,select:focus { outline:2px solid #b3cdf2; }
button { padding:8px 12px; border:1px solid #cad8ea; border-radius:6px; background:#edf4fd; color:#356195; cursor:pointer; font-size:12px; } button:disabled { opacity:.45; cursor:default; } .primary { background:#2e70bb; color:white; } .danger { background:white; color:#ad5961; } .contact-row { display:grid; grid-template-columns:repeat(4,minmax(60px,1fr)) auto; align-items:end; gap:10px; } .error { padding:12px; color:#b04851; background:#fff1f1; border-radius:6px; font-size:13px; }
@media(max-width:850px) { aside { width:210px; } main { padding:14px; } .card { padding:16px; } .contact-row { grid-template-columns:repeat(2,minmax(60px,1fr)); } }
</style>
