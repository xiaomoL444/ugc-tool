<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  createClipComponent,
  getClipComponentTemplates,
  resolveClipComponentTemplate,
} from "../../config/clipComponentRegistry";
import { getLineDefinition } from "../../config/lineRegistry";
import ClipPropertyEditor from "./ClipPropertyEditor.vue";
import type {
  ClipComponent,
  PerformanceClip,
} from "../../types/DialogueNode";

const props = defineProps<{ clip: PerformanceClip }>();
const cameraParameterCount = computed(() =>
  props.clip.components.filter(component => component.templateId === "camera.shot").length,
);
const lineDefinition = computed(() => getLineDefinition(props.clip.type));
const availableTemplates = computed(() => {
  const allowed = lineDefinition.value?.allowedComponentTemplateIds;
  return getClipComponentTemplates(allowed?.length ? allowed : undefined).filter(
    (template) => !template.id.startsWith("base.") &&
      (template.id !== "camera.shot" || cameraParameterCount.value === 0),
  );
});
const selectedTemplateId = ref("");

watch(
  availableTemplates,
  (templates) => {
    if (!templates.some((template) => template.id === selectedTemplateId.value)) {
      selectedTemplateId.value = templates[0]?.id ?? "";
    }
  },
  { immediate: true },
);

function addComponent() {
  if (availableTemplates.value.some(template => template.id === selectedTemplateId.value)) {
    props.clip.components = [...props.clip.components, createClipComponent(selectedTemplateId.value)];
  }
}

function deleteComponent(component: ClipComponent) {
  props.clip.components = props.clip.components.filter((item) => item.id !== component.id);
}

function updateComponent(component: ClipComponent, update: Partial<ClipComponent>) {
  props.clip.components = props.clip.components.map((item) =>
    item.id === component.id ? { ...item, ...update } : item,
  );
}

function updateProperty(component: ClipComponent, key: string, value: unknown) {
  updateComponent(component, { properties: { ...component.properties, [key]: value } });
}

function updateEnabled(component: ClipComponent, event: Event) {
  updateComponent(component, { enabled: (event.target as HTMLInputElement).checked });
}

function addCustomProperty(component: ClipComponent) {
  const key = prompt("输入属性键名", "");
  if (!key?.trim()) return;
  if (Object.prototype.hasOwnProperty.call(component.properties, key)) return;
  updateProperty(component, key, "");
}

function deleteCustomProperty(component: ClipComponent, key: string) {
  const properties = { ...component.properties };
  delete properties[key];
  updateComponent(component, { properties });
}

function resolvedProperties(component: ClipComponent) {
  return resolveClipComponentTemplate(component.templateId)?.properties ?? [];
}

function customProperties(component: ClipComponent) {
  const known = new Set(resolvedProperties(component).map((item) => item.key));
  return Object.keys(component.properties).filter((key) => !known.has(key));
}

function updateString(component: ClipComponent, key: string, event: Event) {
  updateProperty(component, key, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <section class="components-editor">
    <header><strong>Components</strong><span>{{ clip.components.length }}</span></header>
    <p v-if="cameraParameterCount > 1" class="component-warning" role="status">
      当前有 {{ cameraParameterCount }} 份镜头参数，请保留需要的一份并删除其余项。多个启用项的同名参数会由后面的覆盖。
    </p>

    <article v-for="component in clip.components" :key="component.id" class="component-card">
      <div class="component-heading">
        <label class="enabled-toggle">
          <input :checked="component.enabled" type="checkbox" @change="updateEnabled(component, $event)" />
          <span>{{ component.name }}</span>
        </label>
        <button type="button" @click="deleteComponent(component)">删除</button>
      </div>

      <ClipPropertyEditor
        v-for="property in resolvedProperties(component)"
        :key="property.key"
        :property="property"
        :model-value="component.properties[property.key]"
        :sibling-values="component.properties"
        @update:model-value="updateProperty(component, property.key, $event)"
      />

      <label v-for="key in customProperties(component)" :key="key" class="custom-field">
        <span>{{ key }} <em>自定义</em></span>
        <div>
          <input
            :value="String(component.properties[key] ?? '')"
            @input="updateString(component, key, $event)"
          />
          <button type="button" @click="deleteCustomProperty(component, key)">×</button>
        </div>
      </label>

      <button type="button" class="add-property" @click="addCustomProperty(component)">
        ＋ 自定义属性
      </button>
    </article>

    <div class="add-component">
      <select v-model="selectedTemplateId" aria-label="添加组件类型" :disabled="!availableTemplates.length">
        <option v-for="template in availableTemplates" :key="template.id" :value="template.id">
          {{ template.name }}
        </option>
      </select>
      <button type="button" :disabled="!selectedTemplateId" @click="addComponent">＋ 添加</button>
    </div>
  </section>
</template>

<style scoped>
.components-editor { margin-top: 12px; padding-top: 10px; border-top: 1px solid #354154; }
.components-editor > header, .component-heading, .enabled-toggle, .add-component, .custom-field > div { display: flex; align-items: center; }
.components-editor > header, .component-heading { justify-content: space-between; }
.components-editor > header span { color: #71839a; font-size: 10px; }
.component-warning { color: #efc781; font-size: 11px; line-height: 1.5; }
.component-card { margin-top: 8px; padding: 8px; background: #1d2531; border: 1px solid #3b485b; border-radius: 6px; }
.component-card label:not(.enabled-toggle) { display: flex; flex-direction: column; gap: 4px; margin-top: 7px; color: #98a8bc; font-size: 10px; }
.enabled-toggle { gap: 6px; color: #d9e6f7; font-size: 11px; font-weight: 700; }
.boolean-field { flex-direction: row !important; align-items: center; }
input:not([type="checkbox"]), textarea, select { box-sizing: border-box; width: 100%; padding: 6px; color: #edf4ff; background: #141922; border: 1px solid #3b485b; border-radius: 4px; resize: none; }
button { padding: 4px 7px; color: #b9c7da; background: #303a49; border: 1px solid #4a586c; border-radius: 4px; cursor: pointer; }
.add-property { width: 100%; margin-top: 8px; background: transparent; border-style: dashed; }
.add-component { gap: 6px; margin-top: 9px; }
.add-component select { flex: 1; }
.custom-field span em { color: #72839a; font-size: 9px; font-style: normal; }
.custom-field > div { gap: 4px; }
</style>
