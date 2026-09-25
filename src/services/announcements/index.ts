import { computed, ref } from "vue";
import { createOss } from "@/utils/oss";
import config from "@/configs/announcements.json";
import { Announcement, announcementVersion, parseAnnouncementIndex, parseReadState } from "./model";

const oss = createOss(config.directory);
export const readStorageKey = "ugc-tools:announcements:read:v1";
export const announcements = ref<Announcement[]>([]);
export const indexLoading = ref(false);
export const indexFailed = ref(false);
function readSaved() {
  try { return parseReadState(localStorage.getItem(readStorageKey)); } catch { return {}; }
}
const readState = ref(readSaved());
export function isUnread(item: Announcement) {
  return readState.value[item.id] !== announcementVersion(item);
}
export const unreadCount = computed(() => announcements.value.filter(isUnread).length);
export function syncReadState() { readState.value = readSaved(); }
export function markRead(item: Announcement) {
  readState.value = { ...readState.value, ...readSaved(), [item.id]: announcementVersion(item) };
  try { localStorage.setItem(readStorageKey, JSON.stringify(readState.value)); } catch { /* Session-only when storage is unavailable. */ }
}
let pending: Promise<void> | undefined;
let lastAttempt = 0;
export function refreshAnnouncements(force = false): Promise<void> {
  if (pending) return pending;
  if (!force && Date.now() - lastAttempt < 60000) return Promise.resolve();
  lastAttempt = Date.now();
  indexLoading.value = true;
  indexFailed.value = false;
  pending = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(oss.path(config.indexFile) + "?_t=" + Date.now(), {
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Announcement index HTTP " + response.status);
      announcements.value = parseAnnouncementIndex(await response.json());
    } catch {
      indexFailed.value = true;
    } finally {
      window.clearTimeout(timeout);
      indexLoading.value = false;
      pending = undefined;
    }
  })();
  return pending;
}
export function announcementUrl(item: Announcement) {
  return new URL(oss.path(item.content), window.location.href).href;
}
export async function fetchAnnouncement(item: Announcement, signal: AbortSignal) {
  const url = new URL(announcementUrl(item));
  url.searchParams.set("revision", item.revision);
  const response = await fetch(url.href, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Announcement content HTTP " + response.status);
  return response.text();
}
