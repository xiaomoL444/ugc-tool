import { createOss } from "@/utils/oss";
import { reactive } from "vue";
import { EffectItem } from "./types/EffectData";

const oss = createOss("EffectPlayer");

const iconNodes = new Map<string, HTMLImageElement>();
const gifNodes = new Map<string, HTMLImageElement>();
const gifTried = new Set<string>();
const itemsById = new Map<string, EffectItem>();
const hosts = new Map<string, HTMLElement[]>();

export const mediaState = reactive({
  gifReady: {} as Record<string, boolean>,
});

function getPark() {
  let el = document.getElementById("effect-media-park");
  if (!el) {
    el = document.createElement("div");
    el.id = "effect-media-park";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText =
      "position:fixed;left:-9999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.appendChild(el);
  }
  return el;
}

export function iconUrl(item: EffectItem) {
  return oss.path("icon", item.icon || `${item.id}.png`);
}

export function gifUrl(item: EffectItem) {
  const folder = item.isLoop ? "GIFS2" : "GIFS";
  return oss.path(folder, `${item.id}.gif`);
}

export function hasGif(id: string) {
  return Boolean(mediaState.gifReady[id]);
}

function makeImg(className: string) {
  const img = new Image();
  img.className = className;
  img.draggable = false;
  return img;
}

function currentHost(id: string) {
  const list = hosts.get(id);
  return list && list.length ? list[list.length - 1] : null;
}

function mountNodes(id: string, wrap: HTMLElement) {
  const icon = iconNodes.get(id);
  const gif = gifNodes.get(id);
  if (icon && icon.parentElement !== wrap) wrap.appendChild(icon);
  if (gif && gif.parentElement !== wrap) wrap.appendChild(gif);
}

function ensureIconNode(item: EffectItem) {
  let img = iconNodes.get(item.id);
  if (img) return img;
  img = makeImg("effect-image effect-icon");
  img.alt = item.title || item.name || item.id;
  img.addEventListener("load", () => startGif(item), { once: true });
  img.addEventListener(
    "error",
    () => {
      img.style.display = "none";
      startGif(item);
    },
    { once: true },
  );
  img.src = iconUrl(item);
  iconNodes.set(item.id, img);
  return img;
}

function startGif(item: EffectItem) {
  if (gifTried.has(item.id)) return;
  gifTried.add(item.id);
  const img = makeImg("effect-image effect-gif");
  img.alt = item.title || item.name || item.id;
  img.addEventListener(
    "load",
    () => {
      gifNodes.set(item.id, img);
      mediaState.gifReady[item.id] = true;
      const host = currentHost(item.id);
      if (host) host.appendChild(img);
    },
    { once: true },
  );
  img.addEventListener(
    "error",
    () => {
      img.remove();
    },
    { once: true },
  );
  img.src = gifUrl(item);
}

export function attachEffectMedia(wrap: HTMLElement, item: EffectItem) {
  itemsById.set(item.id, item);
  const list = hosts.get(item.id) ?? [];
  const filtered = list.filter((el) => el !== wrap && el.isConnected);
  filtered.push(wrap);
  hosts.set(item.id, filtered);
  ensureIconNode(item);
  mountNodes(item.id, wrap);
  startGif(item);
}

export function parkEffectMedia(id: string, wrap?: HTMLElement | null) {
  const list = (hosts.get(id) ?? []).filter((el) => el !== wrap && el.isConnected);
  hosts.set(id, list);
  const next = list[list.length - 1];
  if (next) {
    mountNodes(id, next);
    return;
  }
  const park = getPark();
  const icon = iconNodes.get(id);
  const gif = gifNodes.get(id);
  if (icon) park.appendChild(icon);
  if (gif) park.appendChild(gif);
}
