<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { toast } from "vue-sonner";
import { downloadTextFile } from "@/utils/download";
import EditorKindSelect from "../EditorKindSelect.vue";
import { useSceneProject } from "./useSceneProject";
import { nextSceneId, contactWorldOptions, updateSceneWorldId, validateSceneProject, type SceneWorld, type SceneMainArea, type SceneSubArea } from "./sceneProject";
import { exportScene } from "./sceneExporter";
import RuntimeImportButton from "../RuntimeImportButton.vue";
withDefaults(defineProps<{ editorKind?: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene" }>(), { editorKind: "Scene" });
const emit = defineEmits<{ "update:editorKind": [value: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene"] }>();
const { project, busy, error, status, retry, prepareToLeave, importConfiguration: importSceneConfiguration } = useSceneProject();
async function importConfiguration(file: File) {
  if (await importSceneConfiguration(file)) choose("world", 0);
}
defineExpose({ prepareToLeave });
const selected = ref<{ kind: "world" | "main" | "sub"; index: number }>({ kind: "world", index: 0 });
const settings = ref(false);
const search = ref("");
const world = computed(() => selected.value.kind === "world" ? project.value?.worlds[selected.value.index] : undefined);
const main = computed(() => selected.value.kind === "main" ? project.value?.mainAreas[selected.value.index] : undefined);
const sub = computed(() => selected.value.kind === "sub" ? project.value?.subAreas[selected.value.index] : undefined);
const selectedItem = computed(() => world.value ?? main.value ?? sub.value);
const selectedKindLabel = computed(() => world.value ? "世界" : main.value ? "一级区域" : "二级区域");
const childAreas = computed(() => {
  if (!project.value) return [];
  if (world.value) return project.value.mainAreas.flatMap((area, index) => area.worldId === world.value!.id ? [{ ...area, index, kind: "main" as const }] : []);
  if (main.value) return project.value.subAreas.flatMap((area, index) => area.mainAreaId === main.value!.id ? [{ ...area, index, kind: "sub" as const }] : []);
  return [];
});
const breadcrumb = computed(() => {
  const parentMain = sub.value ? project.value?.mainAreas.find(area => area.id === sub.value!.mainAreaId) : main.value;
  const parentWorld = parentMain ? project.value?.worlds.find(item => item.id === parentMain.worldId) : world.value;
  return [parentWorld?.name, parentMain?.name, sub.value?.name].filter(Boolean).join(" / ");
});
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
  <div class="scene-editor" :inert="busy" :aria-busy="busy">
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
      <header class="page-header"><div><h2>场景编辑</h2><span role="status" class="save-status">{{ status }}</span></div><div class="actions"><RuntimeImportButton :disabled="busy" :import-file="importConfiguration" /><button :disabled="!project" :aria-pressed="settings" @click="settings = !settings">{{ settings ? '返回场景' : '结构体设置' }}</button><button class="primary" :disabled="!project || busy || !!issues.length" @click="exportVariables">导出场景数据</button></div></header>
      <div v-if="project" class="scene-overview" aria-label="场景概览"><span><strong>{{ project.worlds.length }}</strong> 世界</span><span><strong>{{ project.mainAreas.length }}</strong> 一级区域</span><span><strong>{{ project.subAreas.length }}</strong> 二级区域</span><small>当前工作区 · 自动保存</small></div>
      <p v-if="error" class="error" role="alert">{{ error }} <button :disabled="busy" @click="retry().catch(() => undefined)">重试</button></p>
      <div v-if="issues.length" class="error" role="alert"><p v-for="issue in issues" :key="issue">{{ issue }}</p></div>
      <section v-if="project && settings" class="card"><h3>导出结构体 ID</h3><p class="hint">对应千星编辑器中的结构体类型，不是世界或区域的 ID。</p><div class="field-grid"><label v-for="(label, key) in structLabels" :key="key">{{ label }}<input v-model="project.structIds[key]" inputmode="numeric" /></label></div></section>
      <section v-else-if="project && (world || main || sub)" class="card">
        <div class="card-heading selection-heading"><div><span class="kind-badge">{{ selectedKindLabel }}</span><h3>{{ selectedItem?.name || '未命名' }}</h3><p class="breadcrumb">{{ breadcrumb || '未关联区域' }} <span>· ID {{ selectedItem?.id }}</span></p></div><button class="danger" @click="removeSelected">删除当前项</button></div>
        <h4>基本信息</h4>
        <template v-if="world">
          <div class="field-grid">
          <label>世界 ID<input v-model="idDraft" inputmode="numeric" @blur="changeId(world, $event)" @keydown.enter="changeId(world, $event)" /></label>
          <label>世界名称<input v-model="world.name" /></label>
          </div>
          <section class="connections" aria-label="世界连接点">
          <div class="card-heading"><h4>世界连接点 <span class="count-badge">{{ world.contacts.length }}</span></h4><button :disabled="!contactWorldOptions(project, world).length" @click="addContact(world)">＋ 关联世界</button></div>
          <p class="hint">选择关联的目标世界，并配置对应点位坐标。每个目标世界只能关联一次。</p>
          <div v-for="(point, index) in world.contacts" :key="index" class="contact-row"><label>目标世界<select v-model="point.key"><option v-if="!contactWorldOptions(project, world, point.key).some(target => target.id === point.key)" :value="point.key" disabled>无效关联 · {{ point.key }}</option><option v-for="target in contactWorldOptions(project, world, point.key)" :key="target.id" :value="target.id">{{ target.name }} · {{ target.id }}</option></select></label><label>X<input v-model="point.x" inputmode="decimal" /></label><label>Y<input v-model="point.y" inputmode="decimal" /></label><label>Z<input v-model="point.z" inputmode="decimal" /></label><button class="danger" @click="world.contacts.splice(index, 1)">删除</button></div>
          <p v-if="!world.contacts.length" class="hint">暂无关联世界。请先创建其他世界，再添加连接点。</p>
          </section>
        </template>
        <template v-if="main">
          <div class="field-grid">
          <label>一级区域 ID<input v-model="idDraft" inputmode="numeric" @blur="changeId(main, $event)" @keydown.enter="changeId(main, $event)" /></label>
          <label>区域名称<input v-model="main.name" /></label>
          <label>所属世界<select v-model="main.worldId"><option v-for="item in project.worlds" :key="item.id" :value="item.id">{{ item.name }} · {{ item.id }}</option></select></label>
          </div>
        </template>
        <template v-if="sub">
          <div class="field-grid">
          <label>二级区域 ID<input v-model="idDraft" inputmode="numeric" @blur="changeId(sub, $event)" @keydown.enter="changeId(sub, $event)" /></label>
          <label>区域名称<input v-model="sub.name" /></label>
          <label>所属一级区域<select v-model="sub.mainAreaId"><option v-for="item in project.mainAreas" :key="item.id" :value="item.id">{{ project.worlds.find(row => row.id === item.worldId)?.name }} / {{ item.name }} · {{ item.id }}</option></select></label>
          <label>BGM（整数）<input v-model="sub.bgm" inputmode="numeric" /></label>
          </div>
        </template>
        <section v-if="world || main" class="children-section" aria-label="下级区域">
          <div class="card-heading"><h4>{{ world ? '一级区域' : '二级区域' }} <span class="count-badge">{{ childAreas.length }}</span></h4><button v-if="world" @click="addMain(world)">＋ 一级区域</button><button v-else-if="main" @click="addSub(main)">＋ 二级区域</button></div>
          <div v-if="childAreas.length" class="child-list"><button v-for="area in childAreas" :key="`${area.kind}-${area.index}`" class="child-item" @click="choose(area.kind, area.index)"><span>{{ area.name || '未命名' }}</span><small>ID {{ area.id }}</small><span aria-hidden="true">→</span></button></div>
          <p v-else class="hint">暂无下级区域，点击右上方按钮创建。</p>
        </section>
      </section>
      <section v-else-if="project" class="card empty-state"><h3>开始编辑场景</h3><p class="hint">从左侧选择世界或区域，或创建一个新世界。</p><button :disabled="busy" @click="addWorld">＋ 新建世界</button></section>
    </main>
  </div>
</template>

<style scoped>
.scene-editor { display:flex; height:100%; min-height:0; background:#f4f7fb; color:#334155; text-align:left; }
aside { display:flex; flex-direction:column; width:270px; flex-shrink:0; border-right:1px solid #dbe3ef; overflow:auto; background:#f9fbfe; }
nav { flex:1; padding:12px; }
main { flex:1; min-width:0; overflow:auto; padding:24px; }
header,.card-heading,.tree-heading,.actions { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
header { margin-bottom:22px; } h2 { margin:0 0 6px; font-size:20px; } h3,h4 { margin:0; } header span,.hint,.aside-note { color:#7c899c; font-size:12px; line-height:1.7; }
.tree-heading { padding:18px 12px 8px; } .search { width:calc(100% - 24px); margin:8px 12px; } .aside-note { padding:12px; }
.tree-node { display:block; width:100%; text-align:left; border:0; background:transparent; overflow-wrap:anywhere; white-space:normal; } .tree-node.active { background:#deebff; color:#245baa; } .tree-main { margin-left:14px; border-left:1px solid #dbe3ef; } .tree-sub { padding-left:22px; } small { color:#8b98a9; }
.card { display:grid; gap:16px; padding:22px; border:1px solid #dbe3ef; border-radius:12px; background:white; }
.page-header { margin-bottom:16px; }
.save-status { display:inline-block; }
.scene-overview { display:flex; flex-wrap:wrap; align-items:center; gap:12px 24px; padding:12px 16px; margin-bottom:18px; border:1px solid #dbe3ef; border-radius:8px; background:#edf3fa; color:#64748b; font-size:12px; }
.scene-overview strong { color:#315f98; font-size:18px; margin-right:6px; }
.scene-overview small { margin-left:auto; }
.selection-heading { padding-bottom:16px; border-bottom:1px solid #e7edf5; }
.selection-heading h3 { display:inline; margin-left:10px; font-size:18px; }
.kind-badge,.count-badge { display:inline-block; padding:3px 8px; border-radius:5px; color:#426da0; background:#eaf2ff; font-size:12px; font-weight:normal; }
.breadcrumb { margin:8px 0 0; color:#7c899c; font-size:12px; overflow-wrap:anywhere; }
.field-grid { display:grid; grid-template-columns:minmax(120px,1fr) minmax(180px,2fr); gap:16px; }
.connections,.children-section { display:grid; gap:12px; padding-top:18px; border-top:1px solid #e7edf5; }
.hint { margin:0; }
.contact-row { padding:12px; border:1px solid #e3eaf3; border-radius:8px; background:#f8faff; }
.child-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:10px; }
.child-item { display:flex; align-items:center; gap:12px; padding:14px; text-align:left; background:#f8faff; }
.child-item > span:first-child { flex:1; overflow-wrap:anywhere; }
.child-item small { white-space:nowrap; }
.empty-state { justify-items:start; padding:32px; }
button:not(:disabled):hover { border-color:#8baed8; filter:brightness(.98); }
button:focus-visible { outline:2px solid #6c9edc; outline-offset:2px; }
label { display:grid; gap:7px; font-size:13px; color:#64748b; } input,select { box-sizing:border-box; min-width:0; padding:9px 10px; border:1px solid #cdd8e8; border-radius:6px; color:#334155; background:#fafcff; font:inherit; } input:focus,select:focus { outline:2px solid #b3cdf2; }
button { padding:8px 12px; border:1px solid #cad8ea; border-radius:6px; background:#edf4fd; color:#356195; cursor:pointer; font-size:12px; } button:disabled { opacity:.45; cursor:default; } .primary { background:#2e70bb; color:white; } .danger { background:white; color:#ad5961; } .contact-row { display:grid; grid-template-columns:repeat(4,minmax(60px,1fr)) auto; align-items:end; gap:10px; } .error { padding:12px; color:#b04851; background:#fff1f1; border-radius:6px; font-size:13px; }
@media(max-width:850px) { aside { width:210px; } main { padding:14px; } .card { padding:16px; } .contact-row { grid-template-columns:repeat(2,minmax(60px,1fr)); } }
@media(max-width:600px) { .scene-editor { flex-direction:column; overflow:auto; } aside { width:auto; max-height:260px; flex-shrink:0; border-right:0; border-bottom:1px solid #dbe3ef; } main { flex:none; overflow:visible; } .field-grid { grid-template-columns:minmax(0,1fr); } .child-list { grid-template-columns:minmax(0,1fr); } .scene-overview small { margin-left:0; } }
</style>
