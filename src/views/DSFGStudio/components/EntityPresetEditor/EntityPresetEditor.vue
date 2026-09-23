<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import EditorKindSelect from "../EditorKindSelect.vue";
import StylePresetSection from "./StylePresetSection.vue";
import { stylePresetCategories } from "./stylePresets";
import CustomPresetSection from "./CustomPresetSection.vue";
import { useCustomPresets } from "./customPresets";
import { referenceSources, compatibleReference } from "./presetReferences";
const custom = useCustomPresets();
const activeCategory = ref("publicEvents");
const categories = [{ key: "publicEvents", title: "公共事件" }, { key: "entities", title: "实体" }, { key: "skills", title: "技能动画" }, ...stylePresetCategories, { key: "custom", title: "自定义配置" }];
const sources = computed(() => referenceSources(custom.availablePresets.value));
const styleSections = ref<InstanceType<typeof StylePresetSection>[]>([]);
import { createEntityPreset } from "./entityPresets";
import { useEntityPresets } from "./useEntityPresets";
import { usePublicEventPresets } from "./usePublicEventPresets";
import { createPublicEventPreset, createPublicEventParameter, PUBLIC_EVENT_PARAM_TYPES } from "./publicEventPresets";
import { useSkillAnimationPresets } from "./useSkillAnimationPresets";
import { createSkillAnimationPreset, getSkillAnimationConfigId } from "./skillAnimationPresets";

withDefaults(defineProps<{ editorKind?: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene" }>(), { editorKind: "EntityPresets" });
const emit = defineEmits<{ "update:editorKind": [value: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene"] }>();
const { presets, systemPresets: systemEntities, ready, error, status, retry, flush: flushEntities } = useEntityPresets();
const { presets: skillPresets, systemPresets: systemSkills, ready: skillsReady, error: skillsError, status: skillsStatus, retry: retrySkills, flush: flushSkills } = useSkillAnimationPresets();
const { presets: publicPresets, systemPresets: systemPublicEvents, ready: publicReady, error: publicError, status: publicStatus, retry: retryPublic, flush: flushPublic } = usePublicEventPresets();
function addPublicPreset() { publicPresets.value.push(createPublicEventPreset()); }
async function flush() { await Promise.all([flushEntities(), flushSkills(), flushPublic(), custom.flush(), ...styleSections.value.map(section => section.flush())]); }
const skillList = ref<HTMLElement>();
async function addSkillPreset() {
  skillPresets.value.push(createSkillAnimationPreset());
  await nextTick();
  skillList.value?.querySelector<HTMLElement>("article:last-child input")?.focus();
}
const list = ref<HTMLElement>();
async function addPreset() {
  presets.value.push(createEntityPreset());
  await nextTick();
  list.value?.querySelector<HTMLElement>("article:last-child input")?.focus();
}
defineExpose({ prepareToLeave: flush });
</script>

<template>
  <div class="entity-editor">
    <EditorKindSelect :model-value="editorKind" @update:model-value="emit('update:editorKind', $event)" />
    <div class="settings-layout">
    <nav class="category-nav" aria-label="预设分类"><div class="nav-title">预设配置</div><button v-for="category in categories" :key="category.key" :class="{ active: activeCategory === category.key }" :aria-current="activeCategory === category.key ? 'page' : undefined" @click="activeCategory = category.key">{{ category.title }}</button><p>当前工作区<br />修改后自动保存</p></nav>
    <main>
      <header class="settings-header"><div><h2>预设设置</h2><p>管理当前工作区共用的预设。</p></div></header>
      <section v-show="activeCategory === 'entities'" class="preset-section" aria-labelledby="entity-presets-title">
      <header><div><h3 id="entity-presets-title">预设实体</h3><p>保存常用人物，在对话的「添加对话」中一键创建空白台词。</p></div></header>
      <p class="status" role="status">{{ status }}</p>
      <p v-if="error" role="alert" class="error">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></p>
      <p class="hint">当前工作区共用。修改或删除预设不影响已经创建的对话。</p>
      <h4>系统预设 · 只读</h4>
      <div class="preset-list system-items"><article v-for="preset in systemEntities" :key="preset.id" class="entity-preset"><span class="entity-alias" :title="preset.name || preset.talker">{{ preset.name || preset.talker }}</span><div>Talker<p>{{ preset.talker }}</p></div><div>Subtitle<p>{{ preset.subtitle || '—' }}</p></div><span>系统</span></article></div>
      <p v-if="!systemEntities.length" class="hint">暂无系统预设。</p>
      <header><h4>自定义预设</h4><button type="button" :disabled="!ready" @click="addPreset">＋ 新建人物预设</button></header>
      <div ref="list" class="preset-list">
        <article v-for="(preset, index) in presets" :key="preset.id" class="entity-preset" :aria-label="`人物预设 ${index + 1}`">
          <input v-model="preset.name" class="entity-alias" :aria-label="`人物 ${index + 1} 代号`" :title="preset.name || '代号，仅用于网页显示'" placeholder="代号" />
          <label>Talker · 人名<input v-model="preset.talker" :aria-label="`人物 ${index + 1} Talker`" placeholder="例如：A" /></label>
          <label>Subtitle · 副标题<input v-model="preset.subtitle" :aria-label="`人物 ${index + 1} Subtitle`" placeholder="可留空" /></label>
          <button type="button" class="delete" :aria-label="`删除人物预设 ${index + 1}`" @click="presets = presets.filter(item => item.id !== preset.id)">删除</button>
          <small v-if="!preset.talker.trim()" class="draft-hint">填入人名后，即可在对话中使用。</small>
        </article>
      </div>
      <div v-if="ready && !presets.length" class="empty">还没有人物预设。点击「新建人物预设」，填写人名即可，副标题可留空。</div>
      </section>
      <section v-show="activeCategory === 'skills'" class="preset-section" aria-labelledby="skill-presets-title">
        <header><div><h3 id="skill-presets-title">预设技能动画</h3><p>保存动画名称和技能配置 ID，在 Timeline 的 Player Skill 动作中选择使用。</p></div></header>
        <p class="status" role="status">{{ skillsStatus }}</p>
        <p v-if="skillsError" role="alert" class="error">{{ skillsError }} <button type="button" @click="retrySkills().catch(() => undefined)">重试</button></p>
        <p class="hint">当前工作区共用。修改或删除预设不影响已配置的 Timeline 动作。</p>
        <h4>系统预设 · 只读</h4>
        <div class="preset-list system-items"><article v-for="preset in systemSkills" :key="preset.id"><span class="avatar">动</span><div>动画名<p>{{ preset.name }}</p></div><div>配置 ID<p>{{ preset.configId }}</p></div><span>系统</span></article></div>
        <p v-if="!systemSkills.length" class="hint">暂无系统预设。</p>
        <header><h4>自定义预设</h4><button type="button" :disabled="!skillsReady" @click="addSkillPreset">＋ 新建技能动画预设</button></header>
        <div ref="skillList" class="preset-list">
          <article v-for="(preset, index) in skillPresets" :key="preset.id" :aria-label="`技能动画预设 ${index + 1}`">
            <span class="avatar">动</span>
            <label>动画名<input v-model="preset.name" :aria-label="`技能动画 ${index + 1} 名称`" placeholder="例如：挥手" /></label>
            <label>配置 ID<input v-model="preset.configId" inputmode="numeric" :aria-label="`技能动画 ${index + 1} 配置 ID`" placeholder="填写技能配置 ID" /></label>
            <button type="button" class="delete" :aria-label="`删除技能动画预设 ${index + 1}`" @click="skillPresets = skillPresets.filter(item => item.id !== preset.id)">删除</button>
            <small v-if="!preset.name.trim() || getSkillAnimationConfigId(preset) === null" class="draft-hint">填写动画名和 0–2147483647 范围内的整数配置 ID 后，即可在 Timeline 中使用。</small>
          </article>
        </div>
        <div v-if="skillsReady && !skillPresets.length" class="empty">还没有技能动画预设。新建后填写动画名和对应的配置 ID。</div>
      </section>
      <section v-show="activeCategory === 'publicEvents'" class="preset-section" aria-labelledby="public-presets-title">
        <header><div><h3 id="public-presets-title">预设公共事件</h3><p>代号用于显示和选择，事件名及参数用于执行。在 Timeline 的 Public Event 动作中选择使用。</p></div></header>
        <p class="status" role="status">{{ publicStatus }}</p>
        <p v-if="publicError" role="alert" class="error">{{ publicError }} <button type="button" @click="retryPublic().catch(() => undefined)">重试</button></p>
        <p class="hint">当前工作区共用。修改或删除预设不影响已配置的 Timeline 动作。</p>
        <h4>系统预设 · 只读</h4>
        <div class="preset-list system-items"><article v-for="preset in systemPublicEvents" :key="preset.id" class="public-system-card"><div>代号<p>{{ preset.alias || preset.name }}</p></div><div>事件名<p>{{ preset.name }}</p></div><div>参数<p v-for="param in preset.parameters" :key="param.id">{{ param.name }} · {{ param.type }} · {{ param.defaultValue }}</p></div><span>系统</span></article></div>
        <p v-if="!systemPublicEvents.length" class="hint">暂无系统预设。</p>
        <header><h4>自定义预设</h4><button type="button" :disabled="!publicReady" @click="addPublicPreset">＋ 新建公共事件预设</button></header>
        <div class="preset-list">
          <article class="public-card" v-for="(preset, index) in publicPresets" :key="preset.id" :aria-label="`公共事件预设 ${index + 1}`">
            <label>代号<input v-model="preset.alias" :aria-label="`公共事件 ${index + 1} 代号`" placeholder="例如：开门事件" /></label>
            <label>事件名<input v-model="preset.name" :aria-label="`公共事件 ${index + 1} 名称`" placeholder="例如：打开大门" /></label>
            <div class="public-parameters"><div class="param-heading">参数定义 <span>字符串参数从 stringParams[1] 开始，其余类型从各自列表第 0 项开始。</span></div>
              <div v-for="(param, paramIndex) in preset.parameters" :key="param.id" class="public-param-row">
                <label>参数名称<input v-model="param.name" aria-label="公共事件参数名称" placeholder="参数名称" /></label>
                <label>类型<select v-model="param.type" aria-label="公共事件参数类型" @change="param.reference = undefined"><option v-for="type in PUBLIC_EVENT_PARAM_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
                <label>值来源<select v-model="param.reference" aria-label="公共事件参数预设引用"><option :value="undefined">手动填写</option><option v-if="param.reference && !sources.some(source => source.value === param.reference && compatibleReference(source, param.type))" :value="param.reference">引用已失效（可重新选择）</option><option v-for="source in sources.filter(source => compatibleReference(source, param.type))" :key="source.value" :value="source.value">{{ source.label }}</option></select></label>
                <label>默认值<input v-model="param.defaultValue" aria-label="公共事件参数默认值" placeholder="默认值（可选）" /></label>
                <div class="parameter-visibility">
                  <span>显示条件（全部满足；未设置时始终显示）</span>
                  <div v-for="(rule, ruleIndex) in param.visibleWhen || []" :key="ruleIndex">
                    <select v-model="rule.parameterId" aria-label="显示条件参数">
                      <option value="">选择参数</option>
                      <option v-if="rule.parameterId && !preset.parameters.some(item => item.id === rule.parameterId)" :value="rule.parameterId">参数已删除，请重新选择</option>
                      <option v-for="source in preset.parameters.filter(item => item.id !== param.id)" :key="source.id" :value="source.id">{{ source.name || '未命名参数' }}</option>
                    </select>
                    <span>等于</span><input v-model="rule.equals" aria-label="显示条件匹配值" placeholder="例如：1" />
                    <button type="button" @click="param.visibleWhen?.splice(ruleIndex, 1)">删除条件</button>
                  </div>
                  <button type="button" @click="(param.visibleWhen ??= []).push({ parameterId: '', equals: '' })">＋ 显示条件</button>
                </div>
                <button type="button" :disabled="paramIndex === 0" @click="preset.parameters.splice(paramIndex - 1, 0, preset.parameters.splice(paramIndex, 1)[0])">↑</button>
                <button type="button" @click="preset.parameters.splice(paramIndex, 1)">删除参数</button>
              </div>
              <button type="button" @click="preset.parameters.push(createPublicEventParameter())">＋ 添加参数</button>
            </div>
            <button type="button" class="delete" :aria-label="`删除公共事件预设 ${index + 1}`" @click="publicPresets = publicPresets.filter(item => item.id !== preset.id)">删除</button>
            <small v-if="!preset.name.trim()" class="draft-hint">填写事件名后，即可在 Timeline 中使用。</small>
          </article>
        </div>
        <div v-if="publicReady && !publicPresets.length" class="empty">还没有公共事件预设。新建后填写事件名，再添加所需参数。</div>
      </section>
      <CustomPresetSection v-show="activeCategory === 'custom'" :presets="custom.presets.value" :system-presets="custom.systemPresets.value" :ready="custom.ready.value" :status="custom.status.value" :error="custom.error.value" @retry="custom.retry().catch(() => undefined)" />
      <StylePresetSection v-for="category in stylePresetCategories" v-show="activeCategory === category.key" :key="category.key" ref="styleSections" :category="category.key" :title="category.title" />
    </main>
    </div>
  </div>
</template>

<style scoped>
.public-parameters { display: grid; gap: 8px; }
.parameter-visibility { flex-basis: 100%; display: grid; gap: 6px; padding: 8px; background: #f5f8fc; font-size: 12px; color: #64748b; }
.parameter-visibility > div { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.parameter-visibility > button { justify-self: start; }
.public-param-row { display: flex; gap: 5px; flex-wrap: wrap; }
.public-param-row input { flex: 1; min-width: 90px; }
.public-param-row select { padding: 6px; border: 1px solid #d4deeb; border-radius: 5px; }
.entity-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; color: #334158; background: #f5f7fb; }
main { padding: 24px; overflow: auto; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h2 { font-size: 20px; margin: 0 0 8px; }
h3 { font-size: 16px; margin: 0 0 6px; }
.settings-header { margin-bottom: 20px; }
.system-items article { background: #f4f7fb; color: #617189; overflow-wrap: anywhere; }
.entity-preset { grid-template-columns: minmax(80px, 120px) repeat(2, minmax(0, 1fr)) auto; }
.entity-alias { box-sizing: border-box; display: block; width: 100%; min-width: 0; padding: 10px 8px; border: 1px solid transparent; border-radius: 8px; color: #537db0; background: #eaf1fb; text-align: center; font: inherit; font-size: 13px; overflow-wrap: anywhere; }
input.entity-alias:hover { border-color: #b4d0f4; }
.preset-section + .preset-section { margin-top: 20px; }
.preset-section { max-width: 1100px; padding: 20px; border: 1px solid #dbe4ef; border-radius: 12px; background: #fff; }
p { font-size: 13px; line-height: 1.7; margin: 4px 0; }
.status, .hint { color: #7c899c; font-size: 12px; }
.preset-list { display: grid; gap: 12px; margin-top: 22px; max-width: 900px; }
article { display: grid; grid-template-columns: 32px minmax(100px, 1fr) minmax(100px, 1fr) auto; align-items: center; gap: 16px; padding: 18px; border: 1px solid #dbe4ef; border-radius: 10px; background: #fff; }
.avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: #537db0; background: #eaf1fb; }
label { display: grid; gap: 6px; color: #75839a; font-size: 12px; }
input { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px; border: 1px solid #d4deeb; border-radius: 5px; font: inherit; color: #334158; background: #fafcff; }
input:focus { outline: 2px solid #b4d0f4; }
button { cursor: pointer; border: 1px solid #bed0e5; border-radius: 6px; padding: 8px 12px; color: #315f98; background: #edf4fd; font: inherit; font-size: 12px; }
button:disabled { opacity: .4; cursor: default; }
.delete { color: #a4676c; background: #fff; border-color: #eadcdf; }
.empty { padding: 40px 24px; margin-top: 20px; border: 1px dashed #cedbea; border-radius: 10px; color: #8491a3; font-size: 13px; }
.draft-hint { grid-column: 2 / -1; color: #9b8359; font-size: 11px; }
.error { color: #b95b60; }
@media (max-width: 760px) { main { padding: 14px; } article { grid-template-columns: 28px minmax(80px, 1fr) minmax(80px, 1fr); gap: 10px; padding: 12px; } .delete { grid-column: 2 / -1; justify-self: end; } }
@media (max-width: 760px) { .preset-section { padding: 14px; } }
@media (max-width: 760px) { article.entity-preset { grid-template-columns: minmax(70px, 100px) minmax(0, 1fr); } .entity-preset > label, .entity-preset > div { grid-column: 2; } .entity-preset > .entity-alias { grid-column: 1; grid-row: 1 / span 2; } }

.settings-layout { display:grid; grid-template-columns:180px minmax(0,1fr); flex:1; min-height:0; overflow:hidden; }
.category-nav { padding:24px 14px; border-right:1px solid #dbe4ef; background:#fff; overflow:auto; display:flex; flex-direction:column; gap:6px; }
.nav-title { font-size:12px; font-weight:600; color:#7c899c; padding:0 12px 14px; }
.category-nav button { text-align:left; padding:12px; border-color:transparent; background:transparent; color:#60718a; }
.category-nav button.active { background:#eaf2ff; color:#245aa2; font-weight:600; }
.category-nav p { margin:22px 12px 0; color:#94a0b1; font-size:11px; }
main { min-width:0; } .preset-section { max-width:none; } .preset-section + .preset-section { margin-top:0; } .preset-list { max-width:none; margin-top:12px; }
article.public-card { grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto; gap:16px; padding:20px; }
article.public-system-card { grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,2fr) auto; }
.public-card > .delete { grid-row:1; grid-column:3; } .public-card > .public-parameters { grid-row:2; grid-column:1 / -1; border-top:1px solid #e6edf5; padding-top:16px; }
.public-param-row { display:grid; grid-template-columns:minmax(100px,1fr) 115px minmax(140px,1.3fr) minmax(100px,1fr) auto auto; gap:10px; align-items:end; padding:12px; background:#f6f8fc; border-radius:8px; }
.public-param-row select { width:100%; min-width:0; box-sizing:border-box; padding:9px; color:#334158; background:#fafcff; } .public-param-row input { min-width:0; }
.public-parameters > button { justify-self:start; } .param-heading { font-size:13px; color:#526680; margin-bottom:4px; } .param-heading span { display:block; color:#8693a6; font-size:11px; margin-top:4px; }
@media(max-width:1150px) { .public-param-row { grid-template-columns: minmax(0,1fr) minmax(0,1fr); } }
@media(max-width:760px) { .settings-layout { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); } .category-nav { flex-direction:row; padding:8px; gap:4px; border-right:0; border-bottom:1px solid #dbe4ef; } .category-nav button { white-space:nowrap; } .nav-title,.category-nav p { display:none; } article.public-card { padding:14px; } }
</style>
