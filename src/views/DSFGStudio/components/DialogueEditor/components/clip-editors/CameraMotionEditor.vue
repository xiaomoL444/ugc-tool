<script setup lang="ts">
import { computed } from "vue";
import { CAMERA_POSITION_PROPERTIES, CAMERA_ROTATION_PROPERTIES, normalizeCameraMotion } from "../../config/cameraClip";
import { createClipPropertyValues, getClipListLimits, getClipNestedProperties, isClipPropertyVisible, updateClipStructField } from "../../utils/clipProperties";
import ClipPropertyEditor from "./ClipPropertyEditor.vue";

const props = defineProps<{ kind: "position" | "rotation"; modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [value: Record<string, unknown>] }>();
const definitions = computed(() => props.kind === "position" ? CAMERA_POSITION_PROPERTIES : CAMERA_ROTATION_PROPERTIES);
const slotFields = computed(() => {
  const fields = getClipNestedProperties(definitions.value.find(field => field.key === "slot")!, value.value);
  // Presentation order only: point type on the left, coordinate space on the right.
  return [...fields.filter(field => field.key === "pointType"), ...fields.filter(field => field.key !== "pointType")];
});
const value = computed(() => createClipPropertyValues(definitions.value, normalizeCameraMotion(props.modelValue, props.kind)));
const mode = computed(() => String(value.value.type));
const slots = computed(() => value.value.slot as Record<string, unknown>[]);
const limits = computed(() => getClipListLimits(definitions.value.find(field => field.key === "slot")!, value.value));
const modes = computed(() => definitions.value[0].options ?? []);
const extras = computed(() => definitions.value.filter(field => field.key !== "type" && field.key !== "slot" && isClipPropertyVisible(field, value.value)));
function update(key: string, next: unknown) { emit("update:modelValue", updateClipStructField(definitions.value, value.value, key, next)); }
function updateSlot(index: number, key: string, next: unknown) {
  update("slot", slots.value.map((slot, i) => i === index ? { ...slot, [key]: next } : slot));
}
function addSlot() {
  if (slots.value.length >= limits.value.max) return;
  const point = createClipPropertyValues(slotFields.value);
  update("slot", mode.value === "NOLOC_Linear" ? [point, ...slots.value] : [...slots.value, point]);
}
function removeSlot(index: number) { if (slots.value.length > limits.value.min) update("slot", slots.value.filter((_, i) => i !== index)); }
function swapSlots() { update("slot", [...slots.value].reverse()); }
function slotName(index: number) {
  if (mode.value === "NOLOC_Linear") return slots.value.length === 1 ? "终点" : index === 0 ? "起点" : index === 1 ? "终点" : `点位 ${index + 1}`;
  if (mode.value === "NOLOC_Orbit") return "环绕中心";
  if (mode.value === "NOLOC_Follow" || mode.value === "NOLOC_LookAt") return "目标点位";
  return props.kind === "position" ? "固定位置" : "固定角度";
}
</script>

<template>
  <section class="camera-motion" :aria-label="kind === 'position' ? '相机位置设置' : '视点位置设置'">
    <div class="motion-modes" role="group" :aria-label="kind === 'position' ? '相机位置类型' : '视点位置类型'">
      <button v-for="item in modes" :key="String(item.value)" type="button" class="motion-mode-button"
        :aria-label="item.label" :title="`${item.label}（${item.value}）`" :aria-pressed="mode === item.value" @click="update('type', item.value)">
        <span class="motion-mode-label">{{ item.label }}</span>
        <small class="motion-mode-code">{{ item.value }}</small>
      </button>
    </div>
    <p v-if="!modes.some(item => item.value === mode)" class="camera-notice">当前类型：{{ mode || '未设置' }}。请选择上方类型。</p>
    <div class="slot-heading"><span>{{ mode === 'NOLOC_Linear' ? '运动点位' : '点位设置' }}</span><small>{{ slots.length }} / {{ limits.max }} Slot</small>
      <button v-if="mode === 'NOLOC_Linear' && slots.length === 2" type="button" @click="swapSlots">交换起终点</button>
    </div>
    <p v-if="slots.length > limits.max" class="camera-notice">当前类型只允许 {{ limits.max }} 个点位，请移除多余点位。</p>
    <button v-if="slots.length < limits.max" type="button" class="add-target" @click="addSlot">＋ 添加起点（若不填写起点则获取当前位置）</button>
    <article v-for="(slot, index) in slots" :key="index" class="camera-slot" :aria-label="slotName(index)">
      <header><span class="slot-index">{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ slotName(index) }}</strong>
        <button v-if="slots.length > limits.min" type="button" class="remove-slot" :aria-label="`删除${slotName(index)}`" @click="removeSlot(index)">移除</button>
      </header>
      <div class="slot-fields">
        <ClipPropertyEditor v-for="field in slotFields.filter(field => isClipPropertyVisible(field, slot))" :key="field.key"
          :class="{ 'half-field': field.key === 'space' || field.key === 'pointType' }"
          :property="kind === 'rotation' && slot.pointType === 'NOLOC_Rot' && field.key === 'vector3' ? { ...field, label: '旋转' } : field" :model-value="slot[field.key]" :sibling-values="slot" @update:model-value="updateSlot(index, field.key, $event)" />
      </div>
      <p v-if="kind === 'rotation' && slot.pointType === 'NOLOC_Rot'" class="rot-hint">根据旋转确定视点位置</p>
    </article>
    <div v-if="extras.length" class="motion-extras">
      <ClipPropertyEditor v-for="field in extras" :key="field.key" :property="field" :model-value="value[field.key]" :sibling-values="value" @update:model-value="update(field.key, $event)" />
    </div>
  </section>
</template>

<style scoped>
.motion-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 14px 0 20px; }
.motion-mode-button { min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 60px; padding: 10px 8px; border: 1px solid var(--timeline-border, #35455c); border-radius: 7px; background: transparent; color: var(--timeline-text, #cdd9e8); font-family: inherit; cursor: pointer; }
.motion-mode-button[aria-pressed="true"] { background: var(--timeline-active, #253e5d); border-color: #73a7e9; color: var(--timeline-active-text, #dcecff); }
.motion-mode-label { display: block; font-size: 13px; font-weight: 600; line-height: 1.5; white-space: normal; }
.motion-mode-code { display: block; max-width: 100%; color: var(--timeline-muted, #a6b6cc); font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }
</style>
