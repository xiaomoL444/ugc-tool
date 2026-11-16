<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { toast } from "vue-sonner";
import StudioCreateDialog from "./StudioCreateDialog.vue";
import StudioIcon from "./StudioIcon.vue";
import { studioEditorActiveKey } from "./studioSessionHistory";

const props = defineProps<{
  values: string[];
  selectedValue: string;
  fileLabel: string;
  disabled?: boolean;
  renameFile: (source: string, name: string) => Promise<string | undefined>;
}>();
const emit = defineEmits<{ select: [value: string]; add: []; delete: [value: string] }>();
const active = inject(studioEditorActiveKey, () => true);
const search = ref("");
const visibleFiles = computed(() => props.values.filter(name => name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const menu = shallowRef<{ file: string; trigger: HTMLElement; fromPointer: boolean }>();
const menuPanel = ref<HTMLElement>();
const renameTarget = ref("");
const renameName = ref("");
const renameError = ref("");

function closeMenu(restoreFocus = false) {
  const trigger = menu.value?.trigger;
  menu.value = undefined;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

async function openMenu(file: string, event: MouseEvent, fromPointer = false) {
  if (props.disabled) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  const trigger = fromPointer ? target.querySelector<HTMLButtonElement>(".studio-file-select") ?? target : target;
  if (!fromPointer && menu.value?.trigger === trigger) {
    closeMenu(true);
    return;
  }
  const bounds = trigger.getBoundingClientRect();
  const atCursor = fromPointer && (event.clientX || event.clientY);
  const current = { file, trigger, fromPointer };
  menu.value = current;
  await nextTick();
  const panel = menuPanel.value;
  if (!panel || menu.value !== current) return;
  const { width, height } = panel.getBoundingClientRect();
  const x = atCursor ? event.clientX : bounds.right - width;
  const y = atCursor ? event.clientY : bounds.bottom;
  const right = document.documentElement.clientWidth - width - 8;
  const bottom = document.documentElement.clientHeight - height - 8;
  const top = y + 4 > bottom ? (atCursor ? y : bounds.top) - height - 4 : y + 4;
  panel.style.left = `${Math.max(8, Math.min(x, right))}px`;
  panel.style.top = `${Math.max(8, Math.min(top, bottom))}px`;
  panel.style.visibility = "visible";
  panel.querySelector("button")?.focus({ preventScroll: true });
}

function closeOutside(event: PointerEvent) {
  if (!menu.value) return;
  const path = event.composedPath();
  if (menuPanel.value && path.includes(menuPanel.value)) return;
  if (!menu.value.fromPointer && path.includes(menu.value.trigger)) return;
  closeMenu();
}
function dismissMenu() { closeMenu(); }
watch([active, () => props.disabled, visibleFiles], ([isActive, disabled, files]) => {
  if (menu.value && (!isActive || disabled || !files.includes(menu.value.file))) closeMenu();
});
onMounted(() => {
  window.addEventListener("pointerdown", closeOutside, true);
  window.addEventListener("scroll", dismissMenu, true);
  window.addEventListener("resize", dismissMenu);
  window.addEventListener("blur", dismissMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeOutside, true);
  window.removeEventListener("scroll", dismissMenu, true);
  window.removeEventListener("resize", dismissMenu);
  window.removeEventListener("blur", dismissMenu);
});

function fileAction(action: "rename" | "delete") {
  const file = menu.value?.file;
  if (!file) return;
  closeMenu(true);
  if (action === "delete") emit("delete", file);
  else {
    renameName.value = file.replace(/\.json$/i, "");
    renameError.value = "";
    renameTarget.value = file;
  }
}
async function submitRename() {
  if (props.disabled || !renameTarget.value) return;
  try {
    const destination = await props.renameFile(renameTarget.value, renameName.value);
    renameTarget.value = "";
    if (destination) toast.success(`已重命名为 ${destination}`);
  } catch (error) {
    renameError.value = error instanceof Error ? error.message : "重命名失败，请重试";
  }
}

function navigateMenu(event: KeyboardEvent) {
  if (event.key === "Tab") {
    closeMenu(true);
    return;
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...(menuPanel.value?.querySelectorAll("button") ?? [])];
  if (!buttons.length) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
}
</script>

<template>
  <div class="studio-file-list" :inert="disabled">
    <label class="studio-file-search"><StudioIcon name="search" /><input v-model="search" type="search" placeholder="搜索文件…" aria-label="搜索文件" /></label>
    <div v-if="visibleFiles.length || search.trim()" class="studio-file-items" aria-label="文件列表">
      <div v-for="file in visibleFiles" :key="file" class="studio-file-row" :class="{ selected: selectedValue === file }" @contextmenu="openMenu(file, $event, true)">
        <button type="button" class="studio-file-select" :aria-pressed="selectedValue === file" :title="file" @click="emit('select', file)"><StudioIcon name="file" /><span>{{ file }}</span></button>
        <button type="button" class="studio-file-more" :aria-label="`${file} 的操作`" aria-haspopup="menu"
          :aria-expanded="menu?.file === file" @click="openMenu(file, $event)"><StudioIcon name="more" /></button>
      </div>
      <p v-if="!visibleFiles.length && search.trim()" class="studio-sidebar-hint">没有匹配的文件</p>
    </div>
    <div class="studio-file-actions"><button type="button" @click="emit('add')"><StudioIcon name="plus" :size="16" />新建文件</button><slot name="actions" /></div>
    <Teleport to="body">
      <div v-if="menu" ref="menuPanel" class="studio-file-menu dsfg-typography" role="menu" :aria-label="`${menu.file} 的操作`"
        @contextmenu.prevent @keydown="navigateMenu" @keydown.esc.stop.prevent="closeMenu(true)">
        <button type="button" role="menuitem" @click="fileAction('rename')"><StudioIcon name="pencil" :size="15" />重命名</button>
        <button type="button" role="menuitem" class="danger" @click="fileAction('delete')"><StudioIcon name="trash" :size="15" />删除文件</button>
      </div>
    </Teleport>
    <StudioCreateDialog v-if="renameTarget" v-model="renameName" :title="`重命名${fileLabel}`" :label="`新${fileLabel}名`"
      submit-label="重命名" busy-label="重命名中…" select-on-open :busy="disabled"
      @update:model-value="renameError = ''" @submit="submitRename" @close="renameTarget = ''">
      <p v-if="renameError" class="studio-file-rename-error" role="alert">{{ renameError }}</p>
    </StudioCreateDialog>
  </div>
</template>

<style scoped>
.studio-file-list { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 14px; }
.studio-file-search { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 10px; border: 1px solid #ced3f3; border-radius: 8px; background: #ffffffc9; color: #8b9cc5; }
.studio-file-search input { min-width: 0; width: 100%; padding: 9px 0; border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 400; color: #344672; }
.studio-file-search:focus-within { outline: 2px solid #5aaeff66; }
.studio-file-items { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; align-content: start; gap: 5px; }
.studio-file-row { position: relative; display: flex; align-items: center; min-width: 0; border-radius: 8px; }
.studio-file-row:hover { background: #ffffff9c; }
.studio-file-row.selected { background: linear-gradient(100deg, #b9deffb0, #c9eeff80); }
.studio-file-select { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; min-height: 44px; padding: 11px 10px; border: 0; background: transparent; color: #35446b; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.studio-file-select svg { flex-shrink: 0; }
.studio-file-select span { flex: 1; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.selected .studio-file-select { color: #0788e8; }
.studio-file-more { display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 30px; margin-right: 5px; padding: 0; border: 0; border-radius: 5px; background: transparent; cursor: pointer; color: #5475a8; }
.studio-file-more:hover, .studio-file-more[aria-expanded="true"] { background: #ffffffad; }
.studio-file-menu { position: fixed; top: 0; left: 0; z-index: 10000; visibility: hidden; box-sizing: border-box; min-width: 126px; padding: 5px; border: 1px solid #d7dbed; border-radius: 8px; background: #fff; box-shadow: 0 8px 24px #35487418; }
.studio-file-menu button { display: flex; align-items: center; gap: 7px; width: 100%; padding: 8px; color: #405477; border: 0; border-radius: 4px; background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.studio-file-menu button:hover { background: #edf3ff; }
.studio-file-menu button.danger { color: #af5262; }
.studio-file-menu button.danger:hover { background: #fff0f2; }
.studio-file-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 14px; border-top: 1px solid #cfd7ef88; }
.studio-file-actions > button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid #ced3f3; border-radius: 7px; background: #ffffffb3; color: #42659b; font: inherit; font-size: 12px; cursor: pointer; }
.studio-sidebar-hint { margin: 8px 2px; color: #8593b1; font-size: 12px; line-height: 1.8; }
.studio-file-rename-error { margin: 0; color: #aa3649; }
button:focus-visible { outline: 2px solid #52a5fa; outline-offset: 2px; }
</style>
