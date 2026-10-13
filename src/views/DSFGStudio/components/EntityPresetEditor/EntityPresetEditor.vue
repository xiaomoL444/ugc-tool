<script setup lang="ts">

import StudioSelectField from "../StudioSelectField.vue";
import TypedValueInput from "../TypedValueInput.vue";
import { computed, nextTick, ref, useId } from "vue";
import { toast } from "vue-sonner";
import StudioHistoryToolbar from "../StudioHistoryToolbar.vue";
import { useWorkspacePresetHistory } from "./useWorkspacePresetHistory";
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import StudioSidebarContent from "../StudioSidebarContent.vue";
import type { StudioEditorKind } from "../studioSidebar";
import StylePresetSection from "./StylePresetSection.vue";
import PresetEntryBrowser from "./PresetEntryBrowser.vue";
import { stylePresetCategories } from "./stylePresets";
import CustomPresetSection from "./CustomPresetSection.vue";
import { useCustomPresets } from "./customPresets";
import { referenceSources, compatibleReference } from "./presetReferences";
const activeCategory = ref("publicEvents");
const historyElement = ref<HTMLElement>();
const presetHistory = useWorkspacePresetHistory({
  element: historyElement,
  activeFile: () => (({ entities: "EntityPresets.json", skills: "SkillAnimationPresets.json", publicEvents: "PublicEventPresets.json", custom: "CustomPresets.json" } as Record<string, string>)[activeCategory.value] ?? `${activeCategory.value}.json`),
  activateFile: fileName => {
    activeCategory.value = ({ "EntityPresets.json": "entities", "SkillAnimationPresets.json": "skills", "PublicEventPresets.json": "publicEvents", "CustomPresets.json": "custom" } as Record<string, string>)[fileName] ?? fileName.replace(/\.json$/, "");
  },
  onError: error => toast.error(error instanceof Error ? error.message : "预设恢复失败"),
});
const custom = useCustomPresets();
const categories = [{ key: "publicEvents", title: "公共事件" }, { key: "entities", title: "实体" }, { key: "skills", title: "技能动画" }, ...stylePresetCategories, { key: "custom", title: "自定义配置" }];
const sources = computed(() => referenceSources(custom.availablePresets.value));
const styleSections = ref<InstanceType<typeof StylePresetSection>[]>([]);
import { createEntityPreset } from "./entityPresets";
import { useEntityPresets } from "./useEntityPresets";
import { usePublicEventPresets } from "./usePublicEventPresets";
import { createPublicEventPreset, createPublicEventParameter, changePublicEventParameterType, PUBLIC_EVENT_PARAM_TYPES } from "./publicEventPresets";
import { useSkillAnimationPresets } from "./useSkillAnimationPresets";
import { createSkillAnimationPreset, getSkillAnimationConfigId } from "./skillAnimationPresets";

withDefaults(defineProps<{ editorKind?: StudioEditorKind }>(), { editorKind: "EntityPresets" });
const emit = defineEmits<{ "update:editorKind": [value: StudioEditorKind] }>();
const { presets, customPresets: customEntities, systemPresets: systemEntities, ready, error, status, retry, flush: flushEntities } = useEntityPresets();
const { presets: skillPresets, customPresets: customSkills, systemPresets: systemSkills, ready: skillsReady, error: skillsError, status: skillsStatus, retry: retrySkills, flush: flushSkills } = useSkillAnimationPresets();
const { presets: publicPresets, customPresets: customPublicEvents, systemPresets: systemPublicEvents, ready: publicReady, error: publicError, status: publicStatus, retry: retryPublic, flush: flushPublic } = usePublicEventPresets();
const entityGroups = computed(() => [
  { system: true, title: "系统默认", label: "系统人物", items: systemEntities.value },
  { system: false, title: "自定义预设", label: "人物", items: customEntities.value },
]);
const skillGroups = computed(() => [
  { system: true, title: "系统默认", label: "系统技能动画", items: systemSkills.value },
  { system: false, title: "自定义预设", label: "技能动画", items: customSkills.value },
]);
const publicGroups = computed(() => [
  { system: true, title: "系统默认", label: "系统公共事件", items: systemPublicEvents.value },
  { system: false, title: "自定义预设", label: "公共事件", items: customPublicEvents.value },
]);
const browserCollapsed = ref(false);
const browserId = useId();
const browserToggleLabel = computed(() => browserCollapsed.value ? "展开词条浏览" : "收起词条浏览");
const selectedEntry = ref<{ category: string; id: string }>();
const expandedPublicEvents = ref(new Set<string>());
const browserGroups = computed(() => categories.filter(category => category.key === activeCategory.value).map(category => {
  let entries: { id: string; label: string; detail: string; system: boolean }[];
  if (category.key === "publicEvents") entries = publicGroups.value.flatMap(group => group.items.map(preset => ({ id: preset.id, label: preset.alias || preset.name || "未命名公共事件", detail: preset.name, system: group.system })));
  else if (category.key === "entities") entries = entityGroups.value.flatMap(group => group.items.map(preset => ({ id: preset.id, label: preset.name || preset.talker || "未命名实体", detail: [preset.talker, preset.guid, preset.entityQuery].filter(Boolean).join(" · "), system: group.system })));
  else if (category.key === "skills") entries = skillGroups.value.flatMap(group => group.items.map(preset => ({ id: preset.id, label: preset.name || "未命名技能动画", detail: preset.configId, system: group.system })));
  else if (category.key === "custom") entries = custom.availablePresets.value.map(table => ({ id: table.id, label: table.name || "未命名配置", detail: `${table.fields.length} 个字段 · ${table.records.length} 条记录`, system: custom.systemPresets.value.some(item => item.id === table.id) }));
  else entries = styleSections.value.find(section => section.category === category.key)?.entries ?? [];
  return { key: category.key, title: category.title, entries };
}));
function togglePublicParameters(id: string) {
  if (expandedPublicEvents.value.has(id)) expandedPublicEvents.value.delete(id);
  else expandedPublicEvents.value.add(id);
}
async function selectPresetEntry(category: string, id: string) {
  activeCategory.value = category;
  selectedEntry.value = { category, id };
  await nextTick();
  const cards = historyElement.value?.querySelectorAll<HTMLElement>("[data-preset-id]");
  if (!cards) return;
  let target: HTMLElement | undefined;
  for (const card of cards) {
    card.removeAttribute("data-preset-selected");
    if (card.getAttribute("data-preset-id") === id && card.closest("[data-preset-category]")?.getAttribute("data-preset-category") === category) target = card;
  }
  if (target) {
    target.setAttribute("data-preset-selected", "true");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }
}
// Vue inject reads ancestors; stores created in this provider register directly.
presetHistory.register("EntityPresets.json", presets, ready);
presetHistory.register("SkillAnimationPresets.json", skillPresets, skillsReady);
presetHistory.register("PublicEventPresets.json", publicPresets, publicReady);
presetHistory.register("CustomPresets.json", custom.presets, custom.ready);
function addPublicPreset() { customPublicEvents.value = [...customPublicEvents.value, createPublicEventPreset()]; }
async function flush() { presetHistory.finish(); await Promise.all([flushEntities(), flushSkills(), flushPublic(), custom.flush(), ...styleSections.value.map(section => section.flush())]); }
async function addSkillPreset() {
  customSkills.value = [...customSkills.value, createSkillAnimationPreset()];
  await nextTick();
  historyElement.value?.querySelector<HTMLElement>(".skill-custom-list article:last-child input")?.focus();
}
async function addPreset() {
  customEntities.value = [...customEntities.value, createEntityPreset()];
  await nextTick();
  historyElement.value?.querySelector<HTMLElement>(".entity-custom-list article:last-child input")?.focus();
}
defineExpose({ prepareToLeave: flush });
</script>

<template>
  <SectionLayout title="预设设置" class="entity-editor">
    <div ref="historyElement" class="settings-layout">
    <StudioSidebarContent><nav class="category-nav" aria-label="预设分类"><div class="nav-title">预设配置</div><button v-for="category in categories" :key="category.key" :class="{ active: activeCategory === category.key }" :aria-current="activeCategory === category.key ? 'page' : undefined" @click="activeCategory = category.key">{{ category.title }}</button><p>当前工作区<br />修改后自动保存</p></nav></StudioSidebarContent>
    <div class="preset-workbench" :class="{ 'browser-collapsed': browserCollapsed }">
      <header class="settings-header">
        <div class="settings-heading">
          <button type="button" class="browser-toggle" :aria-label="browserToggleLabel" :title="browserToggleLabel" :aria-expanded="!browserCollapsed" :aria-controls="browserId" @click="browserCollapsed = !browserCollapsed">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7 3v14" /><path v-if="!browserCollapsed" d="M4.5 6v8" class="browser-icon-active" /></svg>
            <span>词条</span><span class="browser-count">{{ browserGroups[0]?.entries.length ?? 0 }}</span>
          </button>
          <div><h2>{{ categories.find(category => category.key === activeCategory)?.title }}</h2><p>管理当前工作区共用的预设，修改后自动保存。</p></div>
        </div>
        <StudioHistoryToolbar :history="presetHistory.current.value" :disabled="activeCategory === 'entityGetMethods'" />
      </header>
    <PresetEntryBrowser :id="browserId" :groups="browserGroups" :active-category="activeCategory" :selected-entry="selectedEntry" :collapsed="browserCollapsed" @select="selectPresetEntry" />
    <main class="preset-content">
      <section v-show="activeCategory === 'entities'" class="preset-section" data-preset-category="entities" aria-labelledby="entity-presets-title">
      <header><div><h3 id="entity-presets-title">预设实体</h3><p>保存常用人物，以及公共事件使用的 guid 和实体查询。</p></div></header>
      <p class="status" role="status">{{ status }}</p>
      <p v-if="error" role="alert" class="error">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></p>
      <p class="hint">当前工作区共用。修改或删除预设不影响已经创建的对话。</p>
      <p class="hint">系统默认的代号固定，人物信息及实体参数可修改。自定义预设可新增、编辑和删除。</p>
      <template v-for="group in entityGroups" :key="group.title">
      <h4>{{ group.title }}</h4>
      <div class="preset-list" :class="group.system ? 'system-items' : 'entity-custom-list'">
        <article v-for="(preset, index) in group.items" :key="preset.id" class="entity-preset" :data-preset-id="preset.id" tabindex="-1" :aria-label="`${group.label}预设 ${index + 1}`">
          <div v-if="group.system" class="entity-alias-field fixed-alias"><span>代号</span><p>{{ preset.name }}</p></div>
          <label v-else class="entity-alias-field">代号<input v-model="preset.name" class="entity-alias" :aria-label="`${group.label} ${index + 1} 代号`" :title="preset.name || '代号，仅用于网页显示'" placeholder="代号" /></label>
          <label>Talker · 人名<input v-model="preset.talker" :aria-label="`${group.label} ${index + 1} Talker`" placeholder="例如：A" /></label>
          <label>Subtitle · 副标题<input v-model="preset.subtitle" :aria-label="`${group.label} ${index + 1} Subtitle`" placeholder="可留空" /></label>
          <label class="entity-guid">guid<TypedValueInput v-model="preset.guid" value-type="Guid" :aria-label="`${group.label} ${index + 1} guid`" placeholder="可留空" /></label>
          <label class="entity-query">实体查询<input v-model="preset.entityQuery" :aria-label="`${group.label} ${index + 1} 实体查询`" placeholder="可留空" /></label>
          <span v-if="group.system" class="entity-actions system-badge">系统</span>
          <button v-else type="button" class="delete entity-actions" :aria-label="`删除人物预设 ${index + 1}`" @click="customEntities = customEntities.filter(item => item.id !== preset.id)">删除</button>
          <small v-if="!preset.talker.trim()" class="draft-hint">填入人名后，即可在对话中使用。</small>
        </article>
      </div>
      </template>
      <div v-if="ready && !customEntities.length" class="empty">还没有自定义人物预设。点击「新建人物预设」，填写人名即可，副标题可留空。</div>
      <div class="preset-footer"><button type="button" :disabled="!ready" @click="addPreset">＋ 新建人物预设</button></div>
      </section>
      <section v-show="activeCategory === 'skills'" class="preset-section" data-preset-category="skills" aria-labelledby="skill-presets-title">
        <header><div><h3 id="skill-presets-title">预设技能动画</h3><p>保存动画名称和技能配置 ID，在 Timeline 的 Player Skill 动作中选择使用。</p></div></header>
        <p class="status" role="status">{{ skillsStatus }}</p>
        <p v-if="skillsError" role="alert" class="error">{{ skillsError }} <button type="button" @click="retrySkills().catch(() => undefined)">重试</button></p>
        <p class="hint">当前工作区共用。修改或删除预设不影响已配置的 Timeline 动作。</p>
        <p class="hint">系统默认的动画名称固定，技能配置 ID 可修改。自定义预设可新增、编辑和删除。</p>
        <template v-for="group in skillGroups" :key="group.title">
        <h4>{{ group.title }}</h4>
        <div class="preset-list" :class="group.system ? 'system-items' : 'skill-custom-list'">
          <article v-for="(preset, index) in group.items" :key="preset.id" :data-preset-id="preset.id" tabindex="-1" :aria-label="`${group.label}预设 ${index + 1}`">
            <span class="avatar">动</span>
            <div v-if="group.system" class="fixed-alias"><span>动画名</span><p>{{ preset.name }}</p></div>
            <label v-else>动画名<input v-model="preset.name" :aria-label="`${group.label} ${index + 1} 名称`" placeholder="例如：挥手" /></label>
            <label>配置 ID<TypedValueInput v-model="preset.configId" value-type="ConfigReference" :aria-label="`${group.label} ${index + 1} 配置 ID`" placeholder="填写技能配置 ID" /></label>
            <span v-if="group.system" class="system-badge">系统</span>
            <button v-else type="button" class="delete" :aria-label="`删除技能动画预设 ${index + 1}`" @click="customSkills = customSkills.filter(item => item.id !== preset.id)">删除</button>
            <small v-if="!preset.name.trim() || getSkillAnimationConfigId(preset) === null" class="draft-hint">填写动画名和 0–2147483647 范围内的整数配置 ID 后，即可在 Timeline 中使用。</small>
          </article>
        </div>
        </template>
        <div v-if="skillsReady && !customSkills.length" class="empty">还没有自定义技能动画预设。新建后填写动画名和对应的配置 ID。</div>
        <div class="preset-footer"><button type="button" :disabled="!skillsReady" @click="addSkillPreset">＋ 新建技能动画预设</button></div>
      </section>
      <section v-show="activeCategory === 'publicEvents'" class="preset-section" data-preset-category="publicEvents" aria-labelledby="public-presets-title">
        <header><div><h3 id="public-presets-title">预设公共事件</h3><p>代号用于显示和选择，事件名及参数用于执行。在 Timeline 的 Public Event 动作中选择使用。</p></div></header>
        <p class="status" role="status">{{ publicStatus }}</p>
        <p v-if="publicError" role="alert" class="error">{{ publicError }} <button type="button" @click="retryPublic().catch(() => undefined)">重试</button></p>
        <p class="hint">当前工作区共用。修改或删除预设不影响已配置的 Timeline 动作。</p>
        <p class="hint">系统默认的代号固定，事件名及参数可修改。自定义预设可新增、编辑和删除；展开参数设置后编辑。</p>
        <template v-for="group in publicGroups" :key="group.title">
        <h4>{{ group.title }}</h4>
        <div class="preset-list" :class="group.system ? 'system-items' : 'public-custom-list'">
          <article class="public-card" :class="{ 'public-system-card': group.system }" v-for="(preset, index) in group.items" :key="preset.id" :data-preset-id="preset.id" tabindex="-1" :aria-label="`${group.label}预设 ${index + 1}`">
            <div v-if="group.system" class="fixed-alias"><span>代号</span><p>{{ preset.alias }}</p></div>
            <label v-else>代号<input v-model="preset.alias" :aria-label="`${group.label} ${index + 1} 代号`" placeholder="例如：开门事件" /></label>
            <label>事件名<input v-model="preset.name" :aria-label="`${group.label} ${index + 1} 名称`" placeholder="例如：打开大门" /></label>
            <div v-if="group.system" class="parameter-preview"><span>参数</span><p v-for="param in preset.parameters" :key="param.id">{{ param.name }} · {{ param.type }} · {{ param.defaultValue }}</p><p v-if="!preset.parameters.length">无参数</p></div>
            <button type="button" class="parameter-toggle" :aria-expanded="expandedPublicEvents.has(preset.id)" :aria-controls="`public-parameters-${group.system ? 'system' : 'custom'}-${index}`" @click="togglePublicParameters(preset.id)"><span aria-hidden="true" class="parameter-arrow">▸</span>参数设置 <span class="parameter-count">{{ preset.parameters.length }} 项</span></button>
            <div v-show="expandedPublicEvents.has(preset.id)" class="public-parameters" :id="`public-parameters-${group.system ? 'system' : 'custom'}-${index}`">
              <div class="parameter-body"><div class="param-heading">参数定义 <span>字符串参数从 stringParams[1] 开始，其余类型从各自列表第 0 项开始。</span></div>
              <div v-for="(param, paramIndex) in preset.parameters" :key="param.id" class="public-param-row">
                <div class="parameter-fields">
                <label>参数名称<input v-model="param.name" aria-label="公共事件参数名称" placeholder="参数名称" /></label>
                <label>类型<StudioSelectField v-model="param.type" aria-label="公共事件参数类型" @change="changePublicEventParameterType(param)"><option v-for="type in PUBLIC_EVENT_PARAM_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option></StudioSelectField></label>
                <label>值来源<StudioSelectField v-model="param.reference" aria-label="公共事件参数预设引用"><option :value="undefined">手动填写</option><option v-if="param.reference && !sources.some(source => source.value === param.reference && compatibleReference(source, param.type))" :value="param.reference">引用已失效（可重新选择）</option><option v-for="source in sources.filter(source => compatibleReference(source, param.type))" :key="source.value" :value="source.value">{{ source.label }}</option></StudioSelectField></label>
                <label>默认值<TypedValueInput v-model="param.defaultValue" :value-type="param.type" aria-label="公共事件参数默认值" placeholder="默认值（可选）" /></label>
                </div>
                <div class="parameter-actions">
                  <button type="button" class="parameter-move" title="上移参数" :aria-label="`上移参数 ${paramIndex + 1}`" :disabled="paramIndex === 0" @click="preset.parameters.splice(paramIndex - 1, 0, preset.parameters.splice(paramIndex, 1)[0])">↑</button>
                  <button type="button" class="parameter-delete" @click="preset.parameters.splice(paramIndex, 1)">删除参数</button>
                </div>
                <div class="parameter-visibility">
                  <div class="visibility-heading"><span>显示条件</span><small>全部满足时显示，未设置时始终显示</small><button type="button" class="visibility-add" @click="(param.visibleWhen ??= []).push({ parameterId: '', equals: '' })">＋ 显示条件</button></div>
                  <div class="visibility-controls">
                    <div v-for="(rule, ruleIndex) in param.visibleWhen || []" :key="ruleIndex" class="visibility-rule">
                      <StudioSelectField v-model="rule.parameterId" class="condition-parameter" aria-label="显示条件参数">
                        <option value="">选择参数</option>
                        <option v-if="rule.parameterId && !preset.parameters.some(item => item.id === rule.parameterId)" :value="rule.parameterId">参数已删除，请重新选择</option>
                        <option v-for="source in preset.parameters.filter(item => item.id !== param.id)" :key="source.id" :value="source.id">{{ source.name || '未命名参数' }}</option>
                      </StudioSelectField>
                      <span class="condition-operator">等于</span><TypedValueInput v-model="rule.equals" class="condition-value" :value-type="preset.parameters.find(item => item.id === rule.parameterId)?.type || 'String'" aria-label="显示条件匹配值" placeholder="例如：1" />
                      <button type="button" class="condition-remove" @click="param.visibleWhen?.splice(ruleIndex, 1)">删除条件</button>
                    </div>
                  </div>
                </div>
              </div>
              <button type="button" @click="preset.parameters.push(createPublicEventParameter())">＋ 添加参数</button>
              </div>
            </div>
            <span v-if="group.system" class="system-badge">系统</span>
            <button v-else type="button" class="delete" :aria-label="`删除公共事件预设 ${index + 1}`" @click="customPublicEvents = customPublicEvents.filter(item => item.id !== preset.id)">删除</button>
            <small v-if="!preset.name.trim()" class="draft-hint">填写事件名后，即可在 Timeline 中使用。</small>
          </article>
        </div>
        </template>
        <div v-if="publicReady && !customPublicEvents.length" class="empty">还没有自定义公共事件预设。新建后填写事件名，再添加所需参数。</div>
        <div class="preset-footer"><button type="button" :disabled="!publicReady" @click="addPublicPreset">＋ 新建公共事件预设</button></div>
      </section>
      <CustomPresetSection v-show="activeCategory === 'custom'" :presets="custom.presets.value" :system-presets="custom.systemPresets.value" :ready="custom.ready.value" :status="custom.status.value" :error="custom.error.value" @retry="custom.retry().catch(() => undefined)" />
      <StylePresetSection v-for="category in stylePresetCategories" v-show="activeCategory === category.key" :key="category.key" ref="styleSections" :category="category.key" :title="category.title" />
    </main>
    </div>
    </div>
  </SectionLayout>
</template>

<style scoped>
.public-parameters { min-width: 0; container: public-parameters / inline-size; }
.parameter-toggle { display: inline-flex; align-items: center; gap: 5px; justify-self: end; white-space: nowrap; }
.parameter-toggle:focus-visible { outline: 2px solid #b4d0f4; outline-offset: 3px; }
.parameter-arrow { display: inline-block; transition: transform .15s ease; }
.parameter-toggle[aria-expanded="true"] .parameter-arrow { transform: rotate(90deg); }
.parameter-toggle[aria-expanded="true"] { background: #dcecff; border-color: #9fbee4; }
.parameter-count { margin-left: 8px; font-size: 12px; color: #8693a6; }
.parameter-body { display: grid; gap: 12px; min-width: 0; }
.system-items article { background: #f5f7ff; color: #617189; border-color: #dce1f5; border-top: 3px solid #0bbcf3; text-align: center; }
.system-items input { text-align: center; }
.fixed-alias, .parameter-preview { min-width: 0; overflow-wrap: anywhere; }
.fixed-alias > span, .parameter-preview > span { color: #75839a; font-size: 12px; }
.fixed-alias p { font-weight: 600; }
.system-badge { color: #75839a; font-size: 12px; }
.public-parameters { text-align: left; }
.preset-footer { display: flex; justify-content: flex-end; margin-top: 16px; }
.parameter-visibility { grid-column: 1 / -1; grid-row: 2; display: grid; gap: 8px; min-width: 0; padding-top: 10px; border-top: 1px solid #e1e7f2; font-size: 12px; color: #64748b; }
.visibility-heading { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.visibility-heading > span { font-weight: 500; }
.visibility-heading small { color: #8e9ab0; font-size: 11px; }
.visibility-heading .visibility-add { margin-left: auto; padding: 5px 9px; border-color: #d7e2ef; color: #5c7c9f; background: #fff; font-size: 11px; white-space: nowrap; }
.visibility-controls { display: grid; gap: 8px; min-width: 0; }
.visibility-rule { display: grid; grid-template-columns: minmax(0,1.2fr) auto minmax(0,1fr) auto; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; border: 1px solid #e3e9f3; border-radius: 7px; background: #fff; }
.visibility-rule :deep(.studio-select-field), .visibility-rule input { width: 100%; min-width: 0; }
.condition-operator { white-space: nowrap; }
.visibility-rule .condition-remove { padding: 7px 9px; border-color: transparent; color: #8a7c92; background: transparent; white-space: nowrap; }
.visibility-rule .condition-remove:hover { border-color: #e6d6df; background: #fcf5f8; }
.entity-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; color: #334158; background: #f5f7fb; }
main { padding: 24px; overflow: auto; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h2 { font-size: 20px; margin: 0 0 8px; }
h3 { font-size: 16px; margin: 0 0 6px; }
h4 { font-size: 13px; margin: 22px 0 10px; color: #526680; }
.settings-header { grid-column: 1 / -1; grid-row: 1; margin: 0 10px 8px; padding: 8px 0 12px; border-bottom: 1px solid #d9dcf0; flex-wrap: nowrap; }
.settings-heading { display: flex; align-items: center; gap: 14px; min-width: 0; }
.settings-heading h2 { margin: 0 0 3px; }
.settings-heading p { margin: 0; color: #7c899c; font-size: 12px; }
.browser-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 0 0 88px; height: 34px; padding: 0 8px; border: 1px solid #cfd5ee; border-radius: 7px; color: #6b7697; background: #ffffffa6; }
.browser-toggle[aria-expanded='true'] { color: #2879b5; border-color: #c3d8ee; background: #eff6ff; }
.browser-toggle:hover { color: #168bc9; border-color: #a6cdea; background: #f6fbff; }
.browser-toggle:focus-visible { outline: 2px solid #91b9ed; outline-offset: 2px; }
.browser-toggle svg { flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.browser-icon-active { stroke-width: 2; }
.browser-count { color: #8e9bb5; font-size: 11px; min-width: 14px; }
.entity-preset { grid-template-columns: minmax(80px, 120px) repeat(4, minmax(0, 1fr)) auto; gap: 12px; padding: 14px 18px; }
.entity-preset > label, .entity-preset > div { min-width: 0; }
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
@media (min-width: 761px) and (max-width: 1150px) { article.entity-preset { grid-template-columns: minmax(80px, 100px) repeat(2, minmax(0, 1fr)) auto; } .entity-guid { grid-column: 2; } .entity-query { grid-column: 3; } .entity-actions { grid-column: 4; grid-row: 1; } }
@media (max-width: 760px) { article.entity-preset { grid-template-columns: minmax(70px, 100px) minmax(0, 1fr); } .entity-preset > label, .entity-preset > div { grid-column: 2; } .entity-preset > .entity-alias-field { grid-column: 1; grid-row: 1 / span 2; } .entity-preset > .entity-actions { grid-column: 2; justify-self: end; } }

.settings-layout { display:grid; grid-template-columns:180px minmax(0,1fr); flex:1; min-height:0; overflow:hidden; }
.preset-workbench { display: grid; grid-template-columns: 216px minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); min-height: 0; min-width: 0; overflow: hidden; }
.preset-workbench.browser-collapsed { grid-template-columns: minmax(0,1fr); }
.preset-content { grid-column: 2; grid-row: 2; min-height: 0; }
.browser-collapsed > .preset-content { grid-column: 1; }
.preset-content :deep([data-preset-id]) { scroll-margin-top: 16px; }
.preset-content :deep([data-preset-selected="true"]) { outline: 2px solid #72b8ef; outline-offset: 3px; }
.category-nav { padding:24px 14px; border-right:1px solid #dbe4ef; background:#fff; overflow:auto; display:flex; flex-direction:column; gap:6px; }
.nav-title { font-size:12px; font-weight:600; color:#7c899c; padding:0 12px 14px; }
.category-nav button { text-align:left; padding:12px; border-color:transparent; background:transparent; color:#60718a; }
.category-nav button.active { background:#eaf2ff; color:#245aa2; font-weight:600; }
.category-nav p { margin:22px 12px 0; color:#94a0b1; font-size:11px; }
main { min-width:0; } .preset-section { max-width:none; } .preset-section + .preset-section { margin-top:0; } .preset-list { max-width:none; margin-top:12px; }
article.public-card { grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto auto; gap:16px; padding:20px; }
article.public-system-card { grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr) auto auto; }
.public-system-card > .system-badge { grid-row:1; grid-column:4; }
.public-card > .parameter-toggle { grid-row:1; grid-column:-2 / -1; }
.public-card > .delete { grid-row:1; grid-column:3; } .public-card > .public-parameters { grid-row:2; grid-column:1 / -1; border-top:1px solid #e6edf5; padding-top:16px; }
.public-param-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; min-width: 0; padding: 14px; border: 1px solid #e0e7f2; background: #f8faff; border-radius: 8px; box-sizing: border-box; }
.parameter-fields { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,.8fr) repeat(2,minmax(0,1fr)); align-items: start; gap: 12px; min-width: 0; }
.parameter-fields > label { min-width: 0; }
.parameter-actions { grid-column: 2; grid-row: 1; display: flex; align-items: center; align-self: start; gap: 6px; padding-top: 20px; }
.parameter-actions button { height: 38px; padding: 0 10px; white-space: nowrap; }
.parameter-actions .parameter-move { width: 34px; padding: 8px 0; }
.parameter-actions .parameter-delete { color: #987787; background: #fff; border-color: #e2dce8; }
.public-param-row select { width:100%; min-width:0; box-sizing:border-box; padding:9px; color:#334158; background:#fafcff; } .public-param-row input { min-width:0; }
.parameter-body > button { justify-self:start; } .param-heading { font-size:13px; color:#526680; margin-bottom:4px; } .param-heading span { display:block; color:#8693a6; font-size:11px; margin-top:4px; }
@container public-parameters (max-width: 680px) { .parameter-fields { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@container public-parameters (max-width: 480px) {
  .public-param-row { grid-template-columns: minmax(0,1fr); }
  .parameter-actions { grid-column: 1; grid-row: 2; justify-self: end; padding-top: 0; }
  .parameter-visibility { grid-row: 3; }
  .visibility-rule { grid-template-columns: auto minmax(0,1fr) auto; }
  .visibility-rule :deep(.condition-parameter) { grid-column: 1 / -1; }
  .condition-operator { grid-column: 1; grid-row: 2; }
  .visibility-rule :deep(.condition-value) { grid-column: 2; grid-row: 2; }
  .condition-remove { grid-column: 3; grid-row: 2; }
}
@container public-parameters (max-width: 360px) {
  .parameter-fields { grid-template-columns: minmax(0,1fr); }
  .visibility-heading { gap: 6px; }
  .visibility-heading small { flex-basis: 100%; }
  .visibility-heading .visibility-add { margin-left: 0; }
}
@media(max-width:1050px) { .preset-workbench { grid-template-columns: 168px minmax(0,1fr); } }
@media(max-width:760px) { .settings-layout { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); } .preset-workbench { grid-template-columns:140px minmax(0,1fr); } .category-nav { flex-direction:row; padding:8px; gap:4px; border-right:0; border-bottom:1px solid #dbe4ef; } .category-nav button { white-space:nowrap; } .nav-title,.category-nav p { display:none; } article.public-card { padding:14px; gap:10px; } article.public-system-card { grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto auto; } .public-system-card > .system-badge { grid-column:3; } .public-system-card > .parameter-preview { grid-column:1 / -1; grid-row:2; } .public-system-card > .public-parameters { grid-row:3; } }
</style>
