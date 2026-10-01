import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import { moveWalkTalkEntry, type WalkTalkProject } from "./walkTalkProject";

/** Pointer movement previews an insertion; only a completed drop changes the project. */
export function useWalkTalkReorder(project: () => WalkTalkProject, list: Ref<HTMLElement | undefined>) {
  const draggingId = ref("");
  const beforeId = ref<string | null>(null);
  const validDrop = ref(false);
  const ghost = ref({ left: 0, top: 0, width: 0, talker: "", content: "" });
  const announcement = ref("");
  let pending: { id: string; pointerId: number; x: number; y: number; left: number; top: number; width: number } | undefined;
  let pointerX = 0;
  let pointerY = 0;
  let frame = 0;
  function locate() {
    const element = list.value;
    if (!element || !draggingId.value) return;
    const bounds = element.getBoundingClientRect();
    validDrop.value = pointerX >= bounds.left && pointerX <= bounds.right && pointerY >= bounds.top && pointerY <= bounds.bottom;
    beforeId.value = null;
    if (!validDrop.value) return;
    for (const row of Array.from(element.querySelectorAll<HTMLElement>("[data-entry-id]"))) {
      if (row.dataset.entryId === draggingId.value) continue;
      const rect = row.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) {
        beforeId.value = row.dataset.entryId ?? null;
        break;
      }
    }
  }
  function scroll() {
    if (!pending) return;
    const element = list.value;
    if (element && draggingId.value && validDrop.value) {
      const bounds = element.getBoundingClientRect();
      const edge = Math.min(48, bounds.height / 4);
      const delta = pointerY < bounds.top + edge ? -Math.min(12, (bounds.top + edge - pointerY) / 3)
        : pointerY > bounds.bottom - edge ? Math.min(12, (pointerY - bounds.bottom + edge) / 3) : 0;
      if (delta) { element.scrollTop += delta; locate(); }
    }
    frame = requestAnimationFrame(scroll);
  }
  function move(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointerId) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!draggingId.value && Math.hypot(pointerX - pending.x, pointerY - pending.y) < 5) return;
    const entry = project().entries.find(entry => entry.id === pending?.id);
    if (!entry) { cancel(); return; }
    event.preventDefault();
    draggingId.value = entry.id;
    ghost.value = { left: pending.left + pointerX - pending.x, top: pending.top + pointerY - pending.y,
      width: pending.width, talker: entry.talker || "未填写说话人", content: entry.content || "未填写台词" };
    locate();
  }
  function cancel() {
    pending = undefined;
    draggingId.value = "";
    beforeId.value = null;
    validDrop.value = false;
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", drop);
    window.removeEventListener("pointercancel", pointerCancel);
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("blur", cancel);
  }
  function drop(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointerId) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    locate();
    if (draggingId.value && validDrop.value) {
      const current = project();
      const source = current.entries.findIndex(entry => entry.id === draggingId.value);
      const remaining = current.entries.filter(entry => entry.id !== draggingId.value);
      const destination = beforeId.value === null ? remaining.length : remaining.findIndex(entry => entry.id === beforeId.value);
      if (source >= 0 && destination >= 0) {
        moveWalkTalkEntry(current, draggingId.value, destination - source);
        announcement.value = `台词已移至第 ${destination + 1} 条`;
      }
    }
    cancel();
  }
  function pointerCancel(event: PointerEvent) { if (event.pointerId === pending?.pointerId) cancel(); }
  function keydown(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); cancel(); } }
  function start(event: PointerEvent, id: string) {
    if (event.button !== 0 || !event.isPrimary || project().entries.length < 2) return;
    const handle = event.currentTarget as HTMLElement;
    const row = handle.closest<HTMLElement>("[data-entry-id]");
    if (!row) return;
    cancel();
    event.preventDefault();
    handle.focus({ preventScroll: true });
    const rect = row.getBoundingClientRect();
    pending = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", cancel);
    frame = requestAnimationFrame(scroll);
  }
  function keyboardMove(event: KeyboardEvent, id: string) {
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    cancel();
    moveWalkTalkEntry(project(), id, event.key === "ArrowUp" ? -1 : 1);
    announcement.value = `台词当前位置：第 ${project().entries.findIndex(entry => entry.id === id) + 1} 条`;
  }
  watch(project, cancel);
  onBeforeUnmount(cancel);
  return { draggingId, beforeId, validDrop, ghost, announcement, start, keyboardMove };
}
