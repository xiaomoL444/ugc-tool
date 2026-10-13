import { t } from "../../i18n";
import { createControlProperties } from "./controlRegistry";
import { normalizeAnimationCollection } from "./animationCollection";
import type { PrimitiveImageResource } from "./primitiveResources";
import type { UINode, UIAnimation, UIKeyframe } from "./types";

type RecordValue = Record<string, any>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number => {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidNumber"));
  return v;
};
export interface SpineImportResult {
  name: string; nodes: UINode[]; resources: PrimitiveImageResource[]; animations: UIAnimation[]; warnings: string[];
}

/** Spine 3.8 JSON region attachments and FK bones. No proprietary .spine decoding. */
export async function convertSpineDocument(data: unknown, name: string, width: number, height: number,
  image: (path: string) => Promise<string>): Promise<SpineImportResult> {
  if (!object(data) || !Array.isArray(data.bones) || !data.bones.length) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidSkeletonJson"));
  if (!/^3\.8(?:\.|$)/.test(String(data.skeleton?.spine ?? ""))) throw new Error(t("clientUIAnimationEditor.ui.spineImport.supportedVersionHint"));
  if (data.bones.length > 1024 || (data.slots?.length ?? 0) > 2048) throw new Error(t("clientUIAnimationEditor.ui.spineImport.boneSlotLimit"));
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidCanvasSize"));
  const warnings = new Set<string>();
  const addWarning = (message: string) => { warnings.add(message); };
  const nodes: UINode[] = [], resources: PrimitiveImageResource[] = [];
  const make = (label: string, type: "container" | "primitive", parent: UINode | null, x: number, y: number, w: number, h: number): UINode => {
    const node = { id: `spine-node-${nodes.length}`, name: label, type, parentId: parent?.id ?? null,
      active: true, visible: true, locked: false, canControllerFocus: false,
      x, y, width: w, height: h, sizeDeltaX: w, sizeDeltaY: h,
      anchorMinX: 0, anchorMinY: 0, anchorMaxX: 0, anchorMaxY: 0, anchorOffsetX: x, anchorOffsetY: y,
      pivotX: type === "container" ? 0 : .5, pivotY: type === "container" ? 0 : .5,
      scaleX: 1, scaleY: 1, scaleZ: 1, rotation: 0, rotationX: 0, rotationY: 0,
      properties: createControlProperties(type), editor: { directionArrowLength: 0 },
    } as UINode;
    nodes.push(node); return node;
  };
  const root = make(name, "container", null, width / 2, height / 2, width, height);
  root.pivotX = root.pivotY = .5;
  const meta = object(data.skeleton) ? data.skeleton : {};
  const offsetX = width / 2 - (num(meta.x) + num(meta.width) / 2);
  const offsetY = height / 2 - (num(meta.y) + num(meta.height) / 2);
  const bones = new Map<string, UINode>();
  for (const bone of data.bones) {
    if (!object(bone) || typeof bone.name !== "string" || !bone.name || bones.has(bone.name)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidBoneName"));
    const parent = bone.parent === undefined ? root : bones.get(bone.parent);
    if (!parent) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidBoneParent", { name: bone.name }));
    if (bone.transform && bone.transform !== "normal" || num(bone.shearX) || num(bone.shearY)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.unsupportedBoneTransform", { name: bone.name }));
    const length = Math.max(0, num(bone.length));
    const node = make(bone.name, "container", parent, num(bone.x) + (parent === root ? offsetX : 0), num(bone.y) + (parent === root ? offsetY : 0), Math.max(1, length), 1);
    node.rotation = num(bone.rotation); node.scaleX = num(bone.scaleX, 1); node.scaleY = num(bone.scaleY, 1);
    node.editor = { directionArrowLength: Math.min(10000, length) };
    bones.set(bone.name, node);
  }
  for (const key of ["ik", "transform", "path"]) if (data[key]?.length) addWarning(t("clientUIAnimationEditor.ui.spineImport.constraintsNotRestored", { key: key }));
  const skins = Array.isArray(data.skins) ? data.skins : [];
  const skin = skins.find(s => s.name === "default") ?? skins[0];
  const attachments = skin?.attachments ?? {};
  if (skins.length > 1) addWarning(t("clientUIAnimationEditor.ui.spineImport.defaultSkinAttachmentsOnly", { name: skin.name }));
  const seenSlots = new Set<string>(), attachmentBones = new Set<string>();
  const images = new Map<string, string>();
  for (const slot of [...(data.slots ?? [])].reverse()) {
    if (!object(slot) || typeof slot.name !== "string" || seenSlots.has(slot.name)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidSlotNames"));
    seenSlots.add(slot.name);
    const parent = bones.get(slot.bone);
    if (!parent) throw new Error(t("clientUIAnimationEditor.ui.spineImport.slotBoneNotFound", { name: slot.name }));
    if (!slot.attachment) continue;
    const attachment = attachments[slot.name]?.[slot.attachment];
    if (!object(attachment)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.missingAttachment", { name: slot.name, attachment: slot.attachment }));
    if (attachment.type && attachment.type !== "region") throw new Error(t("clientUIAnimationEditor.ui.spineImport.unsupportedAttachmentType", { attachment: slot.attachment, type: attachment.type }));
    const path = String(attachment.path ?? slot.attachment);
    let resourceId = images.get(path);
    if (!resourceId) {
      resourceId = `spine-image-${resources.length}`;
      resources.push({ id: resourceId, name: path, imageUrl: await image(path), previewMode: "image", fitData: null });
      images.set(path, resourceId);
    }
    const w = num(attachment.width), h = num(attachment.height);
    if (w <= 0 || h <= 0) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidAttachmentSize", { path: path }));
    const node = make(slot.name, "primitive", parent, num(attachment.x), num(attachment.y), w, h);
    node.rotation = num(attachment.rotation); node.scaleX = num(attachment.scaleX, 1); node.scaleY = num(attachment.scaleY, 1);
    if (node.type === "primitive") node.properties = { imageUrl: "", imageResourceId: resourceId, previewMode: "image" };
    if (slot.blend && slot.blend !== "normal" || slot.color && slot.color.toLowerCase() !== "ffffffff" || attachment.color && attachment.color.toLowerCase() !== "ffffffff") addWarning(t("clientUIAnimationEditor.ui.spineImport.unsupportedTintOrBlend"));
    attachmentBones.add(slot.bone);
  }
  if (attachmentBones.size > 1) addWarning(t("clientUIAnimationEditor.ui.spineImport.crossBoneDrawOrderHint"));
  let keyCount = 0;
  const animations: UIAnimation[] = [];
  for (const [animationName, animation] of Object.entries(data.animations ?? {})) {
    if (!object(animation) || animations.length >= 128) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidAnimationList"));
    const result: UIAnimation = { id: `spine-animation-${animations.length}`, name: animationName, duration: .5, keyframeTracks: [] };
    const inspectTime = (v: any, depth = 0) => {
      if (depth > 32) throw new Error(t("clientUIAnimationEditor.ui.spineImport.animationNestingLimit"));
      if (Array.isArray(v)) v.forEach(e => inspectTime(e, depth + 1));
      else if (object(v)) { if (v.time !== undefined) result.duration = Math.max(result.duration, num(v.time)); Object.values(v).forEach(e => { if (object(e) || Array.isArray(e)) inspectTime(e, depth + 1); }); }
    };
    inspectTime(animation);
    if (result.duration > 600) throw new Error(t("clientUIAnimationEditor.ui.spineImport.animationDurationLimit"));
    for (const key of Object.keys(animation)) if (key !== "bones") addWarning(t("clientUIAnimationEditor.ui.spineImport.unsupportedAnimationTrack", { animationName: animationName, key: key }));
    for (const [boneName, timelines] of Object.entries(animation.bones ?? {})) {
      const node = bones.get(boneName);
      if (!node || !object(timelines)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidAnimationBone", { boneName: boneName }));
      for (const [kind, values] of Object.entries(timelines)) {
        if (kind !== "rotate" && kind !== "translate" && kind !== "scale") { addWarning(t("clientUIAnimationEditor.ui.spineImport.skippedBoneTrack", { boneName: boneName, kind: kind })); continue; }
        if (!Array.isArray(values) || values.length > 10000) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidKeyframeList"));
        const frames = values as RecordValue[];
        frames.forEach((f, i) => { if (!object(f) || num(f.time) < 0 || i && num(f.time) <= num(frames[i - 1].time)) throw new Error(t("clientUIAnimationEditor.ui.spineImport.invalidKeyframeTimeOrder")); });
        const axes = kind === "rotate" ? [["angle", "localRotationZ", node.rotation]] : kind === "scale" ? [["x", "localScaleX", node.scaleX], ["y", "localScaleY", node.scaleY]] : [["x", "anchoredPositionX", node.anchorOffsetX], ["y", "anchoredPositionY", node.anchorOffsetY]];
        for (const [axis, fieldKey, baseline] of axes) {
          const keys: UIKeyframe[] = [];
          const push = (time: number, value: number, step = false) => {
            if (++keyCount > 50000) throw new Error(t("clientUIAnimationEditor.ui.spineImport.keyframeLimitExceeded"));
            keys.push({ id: `spine-key-${keyCount}`, time, value, easeType: "Linear", interpolation: step ? "step" : "tween" });
          };
          if (frames.length && num(frames[0].time) > 0) push(0, Number(baseline), true);
          frames.forEach((frame, i) => {
            // Spine scale keys are factors of the setup scale, not additive offsets.
            const valueAt = (key: RecordValue) => kind === "scale" ? Number(baseline) * num(key[String(axis)], 1) : Number(baseline) + num(key[String(axis)]);
            const time = num(frame.time), start = valueAt(frame);
            push(time, start, frame.curve === "stepped");
            const next = frames[i + 1];
            if (!next || frame.curve === undefined || frame.curve === "stepped") return;
            const control = Array.isArray(frame.curve) ? frame.curve : [frame.curve, frame.c2 ?? 0, frame.c3 ?? 1, frame.c4 ?? 1];
            if (control.length !== 4 || !control.every((v: unknown) => typeof v === "number" && Number.isFinite(v)) || control[0] < 0 || control[0] > 1 || control[2] < 0 || control[2] > 1) throw new Error(t("clientUIAnimationEditor.ui.spineImport.unsupportedBezier"));
            addWarning(t("clientUIAnimationEditor.ui.spineImport.bezierSamplingNotice"));
            const dt = num(next.time) - time, end = valueAt(next);
            const count = Math.max(2, Math.ceil(dt * 30));
            for (let j = 1; j < count; j++) {
              const p = j / count; let lo = 0, hi = 1;
              const cubic = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
              for (let k = 0; k < 24; k++) { const t = (lo + hi) / 2; if (cubic(t, control[0], control[2]) < p) lo = t; else hi = t; }
              push(time + p * dt, start + (end - start) * cubic((lo + hi) / 2, control[1], control[3]));
            }
          });
          if (keys.length) result.keyframeTracks.push({ id: `spine-track-${animations.length}-${result.keyframeTracks.length}`, nodeId: node.id, fieldKey: String(fieldKey), keyframes: keys });
        }
      }
    }
    animations.push(result);
  }
  if (!animations.length) animations.push({ id: "spine-animation-0", name: "默认动画", duration: 5, keyframeTracks: [] });
  return { name, nodes, resources, animations: normalizeAnimationCollection(animations, nodes), warnings: [...warnings.values()] };
}

/** Read only user-selected files; embed image bytes so saved projects are portable. */
export async function importSpineFiles(files: File[], width: number, height: number): Promise<SpineImportResult> {
  if (files.length > 4096 || files.reduce((sum, f) => sum + f.size, 0) > 256 * 1024 * 1024) throw new Error(t("clientUIAnimationEditor.ui.spineImport.folderLimitExceeded"));
  const jsonFiles = files.filter(f => /\.json$/i.test(f.name));
  const skeletonFiles = jsonFiles.filter(f => /^skeleton\.json$/i.test(f.name));
  const candidates = skeletonFiles.length ? skeletonFiles : jsonFiles;
  if (candidates.length !== 1) throw new Error(t(candidates.length ? "clientUIAnimationEditor.ui.spineImport.multipleSkeletonCandidates" : "clientUIAnimationEditor.ui.spineImport.skeletonFileNotFound"));
  const json = candidates[0];
  if (json.size > 16 * 1024 * 1024) throw new Error(t("clientUIAnimationEditor.ui.spineImport.jsonTooLarge"));
  const data = JSON.parse(await json.text());
  const normalize = (path: string) => {
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, "/").split("/")) { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part); }
    return parts.join("/");
  };
  const filePath = (file: File) => normalize(file.webkitRelativePath || file.name);
  const base = filePath(json).split("/").slice(0, -1).join("/");
  const imageFiles = files.filter(f => /\.(png|jpe?g|webp)$/i.test(f.name));
  const name = /^skeleton\.json$/i.test(json.name) ? base.split("/").at(-1) || "Spine 动画" : json.name.replace(/\.json$/i, "");
  const result = await convertSpineDocument(data, name, width, height, async path => {
    const full = /\.(png|jpe?g|webp)$/i.test(path) ? path : path + ".png";
    const candidates = [normalize(`${base}/${data.skeleton?.images ?? ""}/${full}`), normalize(`${base}/${full}`)];
    // Prefer the JSON's image directory before a same-named file beside the JSON.
    let matches: File[] = [];
    for (const candidate of candidates) {
      matches = imageFiles.filter(f => filePath(f) === candidate);
      if (matches.length) break;
    }
    if (!matches.length) matches = imageFiles.filter(f => f.name === full.split("/").at(-1));
    if (matches.length !== 1) throw new Error(t("clientUIAnimationEditor.ui.spineImport.imageFolderRequired", { full: full, value: t(matches.length ? "clientUIAnimationEditor.ui.spineImport.nameConflict" : "clientUIAnimationEditor.ui.spineImport.missingImageLabel") }));
    const file = matches[0];
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reader.onabort = () => reject(new Error(t("clientUIAnimationEditor.ui.spineImport.imageReadFailed", { name: file.name }))); reader.readAsDataURL(file); });
  });
  return result;
}
