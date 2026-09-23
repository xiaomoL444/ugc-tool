<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import type { QxqyStructIds } from "../types/FileStruct";
import {
  createDefaultQxqyStructIds,
  QXQY_STRUCT_ID_FIELDS,
  validateQxqyStructIds,
} from "../utils/qxqyStructWorkspace";

const props = defineProps<{ modelValue: QxqyStructIds }>();
const emit = defineEmits<{
  close: [];
  save: [value: QxqyStructIds];
}>();

const draft = reactive<QxqyStructIds>({ ...props.modelValue });
const errors = computed(() => validateQxqyStructIds(draft));

function resetDefaults() {
  Object.assign(draft, createDefaultQxqyStructIds());
}

function save() {
  if (errors.value.length) return;
  emit(
    "save",
    Object.fromEntries(
      QXQY_STRUCT_ID_FIELDS.map(({ key }) => [key, draft[key].trim()]),
    ) as unknown as QxqyStructIds,
  );
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="struct-id-modal-backdrop dsfg-typography" @pointerdown.self="emit('close')">
      <section
        class="struct-id-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="struct-id-modal-title"
      >
        <header>
          <div>
            <span>QIANXING EXPORT</span>
            <h2 id="struct-id-modal-title">结构体 ID 设置</h2>
          </div>
          <button type="button" aria-label="关闭结构体 ID 设置" @click="emit('close')">
            ×
          </button>
        </header>

        <p class="struct-id-introduction">
          结构体的字段内容保持不变，导出时会把根结构体、字典和 StructList
          中的类型引用统一替换为这里设置的 ID。本配置会跟随编辑器 JSON 保存。
        </p>

        <div class="struct-id-fields">
          <label v-for="field in QXQY_STRUCT_ID_FIELDS" :key="field.key">
            <span class="struct-id-field-copy">
              <strong>{{ field.label }}</strong>
              <small>{{ field.description }}</small>
            </span>
            <input
              v-model="draft[field.key]"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :aria-label="`${field.label} 结构体 ID`"
            />
          </label>
        </div>

        <div v-if="errors.length" class="struct-id-errors" role="alert">
          <span v-for="error in errors" :key="error">{{ error }}</span>
        </div>

        <footer>
          <button type="button" class="reset-button" @click="resetDefaults">
            恢复默认 ID
          </button>
          <div>
            <button type="button" @click="emit('close')">取消</button>
            <button
              type="button"
              class="save-button"
              :disabled="errors.length > 0"
              @click="save"
            >
              保存设置
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.struct-id-modal-backdrop {
  position: fixed;
  z-index: 10000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(16, 25, 38, 0.58);
  backdrop-filter: blur(3px);
}

.struct-id-modal {
  width: min(680px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  color: #243348;
  background: #f7f9fc;
  border: 1px solid #bcc9da;
  border-radius: 12px;
  box-shadow: 0 24px 70px rgba(9, 24, 43, 0.34);
}

.struct-id-modal header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 15px;
  background: #edf3fa;
  border-bottom: 1px solid #ccd7e4;
}

.struct-id-modal header span {
  color: #65809e;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.struct-id-modal h2 {
  margin: 3px 0 0;
  font-size: 18px;
}

.struct-id-modal header button {
  width: 34px;
  height: 34px;
  color: #5d6f84;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 24px;
  cursor: pointer;
}

.struct-id-modal header button:hover {
  color: #253b55;
  background: #dfe8f3;
  border-color: #c4d1e0;
}

.struct-id-introduction {
  margin: 0;
  padding: 16px 22px 4px;
  color: #687b92;
  font-size: 12px;
  line-height: 1.65;
}

.struct-id-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 14px 22px 18px;
}

.struct-id-fields label {
  display: grid;
  gap: 8px;
  padding: 12px;
  background: #fff;
  border: 1px solid #d6dee9;
  border-radius: 8px;
}

.struct-id-field-copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.struct-id-field-copy strong {
  font-size: 12px;
}

.struct-id-field-copy small {
  overflow: hidden;
  color: #8291a4;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.struct-id-fields input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  color: #193a61;
  background: #f5f8fc;
  border: 1px solid #bdcad9;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}

.struct-id-fields input:focus {
  border-color: #3382cf;
  box-shadow: 0 0 0 3px rgba(51, 130, 207, 0.13);
}

.struct-id-errors {
  display: grid;
  gap: 4px;
  margin: -4px 22px 16px;
  padding: 10px 12px;
  color: #a43b3b;
  background: #fff0f0;
  border: 1px solid #efc1c1;
  border-radius: 7px;
  font-size: 11px;
}

.struct-id-modal footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 22px;
  background: #edf3fa;
  border-top: 1px solid #ccd7e4;
}

.struct-id-modal footer div {
  display: flex;
  gap: 8px;
}

.struct-id-modal footer button {
  padding: 7px 14px;
  color: #3f526a;
  background: #fff;
  border: 1px solid #bdcad9;
  border-radius: 6px;
  cursor: pointer;
}

.struct-id-modal footer .reset-button {
  color: #5e7086;
  background: transparent;
}

.struct-id-modal footer .save-button {
  color: #fff;
  background: #2877c7;
  border-color: #1764b2;
}

.struct-id-modal footer .save-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .struct-id-fields {
    grid-template-columns: 1fr;
  }

  .struct-id-modal footer {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .struct-id-modal footer div,
  .struct-id-modal footer button {
    flex: 1;
  }
}
</style>
