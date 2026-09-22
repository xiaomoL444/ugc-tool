<script setup lang="ts">
import { computed } from "vue";
import { CAMERA_POSITION_PROPERTIES, CAMERA_ROTATION_PROPERTIES } from "../../config/cameraClip";
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
const value = computed(() => createClipPropertyValues(definitions.value, props.modelValue));
const mode = computed(() => String(value.value.type));
const slots = computed(() => value.value.slot as Record<string, unknown>[]);
const limits = computed(() => getClipListLimits(definitions.value.find(field => field.key === "slot")!, value.value));
const modes = computed(() => definitions.value[0].options ?? []);
const labels: Record<string, string> = { Fixed: "固定", Linear: "线性", Follow: "跟随", Orbit: "环绕", LookAt: "朝向目标" };
const extras = computed(() => definitions.value.filter(field => field.key !== "type" && field.key !== "slot" && isClipPropertyVisible(field, value.value)));
function update(key: string, next: unknown) { emit("update:modelValue", updateClipStructField(definitions.value, value.value, key, next)); }
function updateSlot(index: number, key: string, next: unknown) {
  update("slot", slots.value.map((slot, i) => i === index ? { ...slot, [key]: next } : slot));
}
function addSlot() { if (slots.value.length < limits.value.max) update("slot", [...slots.value, createClipPropertyValues(slotFields.value)]); }
function removeSlot(index: number) { if (slots.value.length > limits.value.min) update("slot", slots.value.filter((_, i) => i !== index)); }
function swapSlots() { update("slot", [...slots.value].reverse()); }
function slotName(index: number) {
  if (mode.value === "Linear") return index === 0 ? "起点" : index === 1 ? "终点" : `点位 ${index + 1}`;
  if (mode.value === "Orbit") return "环绕中心";
  if (mode.value === "Follow" || mode.value === "LookAt") return "目标点位";
  return props.kind === "position" ? "固定相机位置" : "固定视点位置";
}
</script>

<template>
  <section class="camera-motion" :aria-label="kind === 'position' ? '相机位置设置' : '视点位置设置'">
    <div class="motion-modes" role="group" :aria-label="kind === 'position' ? '相机位置类型' : '视点位置类型'">
      <button v-for="item in modes" :key="String(item.value)" type="button" :aria-pressed="mode === item.value" @click="update('type', item.value)">
        <strong>{{ labels[String(item.value)] }}</strong><small>{{ item.value }}</small>
      </button>
    </div>
    <p v-if="!modes.some(item => item.value === mode)" class="camera-notice">当前类型：{{ mode || '未设置' }}。请选择上方类型。</p>
    <div class="slot-heading"><span>{{ mode === 'Linear' ? '运动点位' : '点位设置' }}</span><small>{{ slots.length }} / {{ limits.max }} Slot</small>
      <button v-if="mode === 'Linear' && slots.length === 2" type="button" @click="swapSlots">交换起终点</button>
    </div>
    <p v-if="slots.length > limits.max" class="camera-notice">当前类型只允许 {{ limits.max }} 个点位，请移除多余点位。</p>
    <article v-for="(slot, index) in slots" :key="index" class="camera-slot" :aria-label="slotName(index)">
      <header><span class="slot-index">{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ slotName(index) }}</strong>
        <button v-if="slots.length > limits.min" type="button" class="remove-slot" :aria-label="`删除${slotName(index)}`" @click="removeSlot(index)">移除</button>
      </header>
      <div class="slot-fields">
        <ClipPropertyEditor v-for="field in slotFields.filter(field => isClipPropertyVisible(field, slot))" :key="field.key"
          :class="{ 'half-field': field.key === 'space' || field.key === 'pointType' }"
          :property="kind === 'rotation' && slot.pointType === 'Rot' && field.key === 'vector3' ? { ...field, label: '旋转' } : field" :model-value="slot[field.key]" :sibling-values="slot" @update:model-value="updateSlot(index, field.key, $event)" />
      </div>
      <p v-if="kind === 'rotation' && slot.pointType === 'Rot'" class="rot-hint">根据旋转确定视点位置</p>
    </article>
    <button v-if="slots.length < limits.max" type="button" class="add-target" @click="addSlot">＋ 添加终点</button>
    <div v-if="extras.length" class="motion-extras">
      <ClipPropertyEditor v-for="field in extras" :key="field.key" :property="field" :model-value="value[field.key]" :sibling-values="value" @update:model-value="update(field.key, $event)" />
    </div>
  </section>
</template>
