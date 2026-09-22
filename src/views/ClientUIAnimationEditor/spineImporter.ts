import { createControlProperties } from "./controlRegistry";
import { normalizeAnimationCollection } from "./animationCollection";
import type { PrimitiveImageResource } from "./primitiveResources";
import type { UINode, UIAnimation, UIKeyframe } from "./types";

type RecordValue = Record<string, any>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback = 0): number => {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Spine 中存在无效数值。");
  return v;
};
export interface SpineImportResult {
  name: string; nodes: UINode[]; resources: PrimitiveImageResource[]; animations: UIAnimation[]; warnings: string[];
}

/** Spine 3.8 JSON region attachments and FK bones. No proprietary .spine decoding. */
export async function convertSpineDocument(data: unknown, name: string, width: number, height: number,
  image: (path: string) => Promise<string>): Promise<SpineImportResult> {
  if (!object(data) || !Array.isArray(data.bones) || !data.bones.length) throw new Error("不是有效的 Spine skeleton JSON。");
  if (!/^3\.8(?:\.|$)/.test(String(data.skeleton?.spine ?? ""))) throw new Error("目前支持 Spine 3.8 JSON，请从 Spine 导出对应版本的 JSON 和原始图片。");
  if (data.bones.length > 1024 || (data.slots?.length ?? 0) > 2048) throw new Error("Spine 骨骼或插槽数量过多。");
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error("画布尺寸无效。");
  const warnings = new Set<string>();
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
    if (!object(bone) || typeof bone.name !== "string" || !bone.name || bones.has(bone.name)) throw new Error("骨骼名称缺失或重复。");
    const parent = bone.parent === undefined ? root : bones.get(bone.parent);
    if (!parent) throw new Error(`骨骼「${bone.name}」的父骨骼不存在或顺序错误。`);
    if (bone.transform && bone.transform !== "normal" || num(bone.shearX) || num(bone.shearY)) throw new Error(`骨骼「${bone.name}」含暂不支持的继承模式或剪切变换。`);
    const length = Math.max(0, num(bone.length));
    const node = make(bone.name, "container", parent, num(bone.x) + (parent === root ? offsetX : 0), num(bone.y) + (parent === root ? offsetY : 0), Math.max(1, length), 1);
    node.rotation = num(bone.rotation); node.scaleX = num(bone.scaleX, 1); node.scaleY = num(bone.scaleY, 1);
    node.editor = { directionArrowLength: Math.min(10000, length) };
    bones.set(bone.name, node);
  }
  for (const key of ["ik", "transform", "path"]) if (data[key]?.length) warnings.add(`${key} 约束未还原，仅导入 FK 姿态`);
  const skins = Array.isArray(data.skins) ? data.skins : [];
  const skin = skins.find(s => s.name === "default") ?? skins[0];
  const attachments = skin?.attachments ?? {};
  if (skins.length > 1) warnings.add(`仅导入皮肤 ${skin.name} 的默认附件`);
  const seenSlots = new Set<string>(), attachmentBones = new Set<string>();
  const images = new Map<string, string>();
  for (const slot of [...(data.slots ?? [])].reverse()) {
    if (!object(slot) || typeof slot.name !== "string" || seenSlots.has(slot.name)) throw new Error("插槽名称缺失或重复。");
    seenSlots.add(slot.name);
    const parent = bones.get(slot.bone);
    if (!parent) throw new Error(`插槽「${slot.name}」找不到骨骼。`);
    if (!slot.attachment) continue;
    const attachment = attachments[slot.name]?.[slot.attachment];
    if (!object(attachment)) throw new Error(`缺少附件「${slot.name}/${slot.attachment}」。`);
    if (attachment.type && attachment.type !== "region") throw new Error(`附件「${slot.attachment}」是 ${attachment.type}，目前仅支持普通图片 region，不支持网格或蒙皮。`);
    const path = String(attachment.path ?? slot.attachment);
    let resourceId = images.get(path);
    if (!resourceId) {
      resourceId = `spine-image-${resources.length}`;
      resources.push({ id: resourceId, name: path, imageUrl: await image(path), previewMode: "image", fitData: null });
      images.set(path, resourceId);
    }
    const w = num(attachment.width), h = num(attachment.height);
    if (w <= 0 || h <= 0) throw new Error(`附件「${path}」缺少有效宽高。`);
    const node = make(slot.name, "primitive", parent, num(attachment.x), num(attachment.y), w, h);
    node.rotation = num(attachment.rotation); node.scaleX = num(attachment.scaleX, 1); node.scaleY = num(attachment.scaleY, 1);
    if (node.type === "primitive") node.properties = { imageUrl: "", imageResourceId: resourceId, previewMode: "image" };
    if (slot.blend && slot.blend !== "normal" || slot.color && slot.color.toLowerCase() !== "ffffffff" || attachment.color && attachment.color.toLowerCase() !== "ffffffff") warnings.add("插槽/附件染色和特殊混合模式未还原");
    attachmentBones.add(slot.bone);
  }
  if (attachmentBones.size > 1) warnings.add("跨骨骼的插槽绘制顺序可能与 Spine 不同；同骨骼内顺序已保留");
  let keyCount = 0;
  const animations: UIAnimation[] = [];
  for (const [animationName, animation] of Object.entries(data.animations ?? {})) {
    if (!object(animation) || animations.length >= 128) throw new Error("动画格式无效或超过 128 个。");
    const result: UIAnimation = { id: `spine-animation-${animations.length}`, name: animationName, duration: .5, keyframeTracks: [] };
    const inspectTime = (v: any, depth = 0) => {
      if (depth > 32) throw new Error("动画数据嵌套过深。");
      if (Array.isArray(v)) v.forEach(e => inspectTime(e, depth + 1));
      else if (object(v)) { if (v.time !== undefined) result.duration = Math.max(result.duration, num(v.time)); Object.values(v).forEach(e => { if (object(e) || Array.isArray(e)) inspectTime(e, depth + 1); }); }
    };
    inspectTime(animation);
    if (result.duration > 600) throw new Error("单个动画不能超过 600 秒。");
    for (const key of Object.keys(animation)) if (key !== "bones") warnings.add(`动画 ${animationName} 的 ${key} 轨道未导入`);
    for (const [boneName, timelines] of Object.entries(animation.bones ?? {})) {
      const node = bones.get(boneName);
      if (!node || !object(timelines)) throw new Error(`动画引用了无效骨骼「${boneName}」。`);
      for (const [kind, values] of Object.entries(timelines)) {
        if (kind !== "rotate" && kind !== "translate") { warnings.add(kind === "scale" ? "已跳过 X/Y 缩放动画：游戏内 localScaleX / localScaleY Tween 无效，静态缩放保留" : `骨骼 ${boneName} 的 ${kind} 轨道未导入`); continue; }
        if (!Array.isArray(values) || values.length > 10000) throw new Error("关键帧格式无效或数量过多。");
        const frames = values as RecordValue[];
        frames.forEach((f, i) => { if (!object(f) || num(f.time) < 0 || i && num(f.time) <= num(frames[i - 1].time)) throw new Error("关键帧时间必须递增且非负。"); });
        const axes = kind === "rotate" ? [["angle", "localRotationZ", node.rotation]] : [["x", "anchoredPositionX", node.anchorOffsetX], ["y", "anchoredPositionY", node.anchorOffsetY]];
        for (const [axis, fieldKey, baseline] of axes) {
          const keys: UIKeyframe[] = [];
          const push = (time: number, value: number, step = false) => {
            if (++keyCount > 50000) throw new Error("转换后的关键帧超过 50000 个。");
            keys.push({ id: `spine-key-${keyCount}`, time, value, easeType: "Linear", interpolation: step ? "step" : "tween" });
          };
          if (frames.length && num(frames[0].time) > 0) push(0, Number(baseline), true);
          frames.forEach((frame, i) => {
            const time = num(frame.time), start = Number(baseline) + num(frame[String(axis)]);
            push(time, start, frame.curve === "stepped");
            const next = frames[i + 1];
            if (!next || frame.curve === undefined || frame.curve === "stepped") return;
            const control = Array.isArray(frame.curve) ? frame.curve : [frame.curve, frame.c2 ?? 0, frame.c3 ?? 1, frame.c4 ?? 1];
            if (control.length !== 4 || !control.every((v: unknown) => typeof v === "number" && Number.isFinite(v)) || control[0] < 0 || control[0] > 1 || control[2] < 0 || control[2] > 1) throw new Error("不支持的 Spine 贝塞尔曲线。");
            warnings.add("贝塞尔缓动已按 30 Hz 采样为线性关键帧近似，可继续编辑");
            const dt = num(next.time) - time, end = Number(baseline) + num(next[String(axis)]);
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
  return { name, nodes, resources, animations: normalizeAnimationCollection(animations, nodes), warnings: [...warnings] };
}

/** Read only user-selected files; embed image bytes so saved projects are portable. */
export async function importSpineFiles(files: File[], width: number, height: number): Promise<SpineImportResult> {
  if (files.length > 4096 || files.reduce((sum, f) => sum + f.size, 0) > 256 * 1024 * 1024) throw new Error("Spine 文件夹超过 4096 个文件或 256 MB。");
  const jsonFiles = files.filter(f => /\.json$/i.test(f.name));
  const skeletonFiles = jsonFiles.filter(f => /^skeleton\.json$/i.test(f.name));
  const candidates = skeletonFiles.length ? skeletonFiles : jsonFiles;
  if (candidates.length !== 1) throw new Error(candidates.length ? "文件夹内有多个 JSON 骨骼候选文件，请选择只包含一份 skeleton.json 的文件夹。" : "未找到 skeleton.json，请选择包含 Spine 导出的骨骼 JSON 和原始图片的文件夹，不需要 .spine 工程文件。");
  const json = candidates[0];
  if (json.size > 16 * 1024 * 1024) throw new Error("Spine JSON 超过 16 MB。");
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
    if (matches.length !== 1) throw new Error(`图片「${full}」${matches.length ? "存在同名冲突" : "缺失"}，请选择包含 JSON 和原始图片的完整文件夹（不支持 atlas 裁图）。`);
    const file = matches[0];
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reader.onabort = () => reject(new Error(`无法读取图片 ${file.name}`)); reader.readAsDataURL(file); });
  });
  return result;
}
