import type { ColorRGBA } from "../ClientUIAnimationEditor/types";

export const PARTICLE_SCHEMA = "UGCTools.UIParticles@1";
export const MAX_CONTROLS = 1024;
export interface Range { min: number; max: number }
export interface Point { x: number; y: number }
export interface CurveKey { t: number; value: number }
export interface ParticleEmitter {
  id: string; name: string; enabled: boolean; seed: number; imageId: number | null;
  origin: Point; delay: number; duration: number; loop: boolean; maxParticles: number;
  rate: number; burst: number; lifetime: Range; size: Range; speed: Range;
  angle: number; spread: number; rotation: Range; spin: Range;
  shape: "point" | "circle" | "ring" | "box";
  radius: number; width: number; height: number;
  motion: "velocity" | "bezier"; gravity: Point;
  control1: Point; control2: Point; target: Point;
  sizeCurve: CurveKey[]; alphaCurve: CurveKey[];
  startColor: ColorRGBA; endColor: ColorRGBA;
}
export interface ParticleProject {
  schema: typeof PARTICLE_SCHEMA; name: string; width: number; height: number;
  previewDuration: number; emitters: ParticleEmitter[];
}
export type PresetName = "stars" | "snow" | "coins";
let serial = 0;
export const newEmitterId = () => `emitter_${Date.now().toString(36)}_${++serial}`;
export const copyProject = (project: ParticleProject): ParticleProject => JSON.parse(JSON.stringify(project));
export function createEmitter(name = "星光发射器"): ParticleEmitter {
  return {
    id: newEmitterId(), name, enabled: true, seed: 12345, imageId: null,
    origin: { x: 0, y: 0 }, delay: 0, duration: 2, loop: true, maxParticles: 100,
    rate: 28, burst: 16, lifetime: { min: .8, max: 1.6 }, size: { min: 8, max: 20 },
    speed: { min: 60, max: 170 }, angle: 90, spread: 360,
    rotation: { min: 0, max: 360 }, spin: { min: -90, max: 90 },
    shape: "circle", radius: 12, width: 220, height: 100,
    motion: "velocity", gravity: { x: 0, y: -35 },
    control1: { x: -180, y: 200 }, control2: { x: 120, y: 240 }, target: { x: 260, y: 80 },
    sizeCurve: [{ t: 0, value: .35 }, { t: .15, value: 1 }, { t: 1, value: .15 }],
    alphaCurve: [{ t: 0, value: 0 }, { t: .1, value: 1 }, { t: .7, value: .9 }, { t: 1, value: 0 }],
    startColor: { r: 255, g: 239, b: 183, a: 1 }, endColor: { r: 255, g: 146, b: 73, a: 1 },
  };
}
export function createPreset(preset: PresetName, imageId: number | null = null): ParticleProject {
  const emitter = createEmitter(); emitter.imageId = imageId;
  let name = "星光散射";
  if (preset === "snow") {
    name = "轻雪飘落";
    Object.assign(emitter, {
      name: "雪花", shape: "box", origin: { x: 0, y: 230 }, width: 760, height: 15,
      duration: 6, rate: 18, burst: 0, maxParticles: 140,
      lifetime: { min: 5, max: 7 }, size: { min: 4, max: 11 }, speed: { min: 30, max: 60 },
      angle: -90, spread: 30, gravity: { x: 2, y: -4 }, spin: { min: -30, max: 30 },
      startColor: { r: 225, g: 241, b: 255, a: .9 }, endColor: { r: 179, g: 210, b: 255, a: .4 },
      sizeCurve: [{ t: 0, value: .7 }, { t: .2, value: 1 }, { t: 1, value: .7 }],
    });
  } else if (preset === "coins") {
    name = "金币汇聚";
    Object.assign(emitter, {
      name: "收集光点", motion: "bezier", shape: "circle", radius: 60,
      origin: { x: -180, y: -80 }, duration: 2.5, rate: 12, burst: 10,
      lifetime: { min: 1, max: 1.8 }, size: { min: 12, max: 22 },
      control1: { x: -100, y: 230 }, control2: { x: 300, y: -80 }, target: { x: 430, y: 210 },
      sizeCurve: [{ t: 0, value: .3 }, { t: .2, value: 1 }, { t: .8, value: .7 }, { t: 1, value: .2 }],
      startColor: { r: 255, g: 224, b: 100, a: 1 }, endColor: { r: 255, g: 249, b: 216, a: 1 },
    });
  }
  return { schema: PARTICLE_SCHEMA, name, width: 960, height: 540, previewDuration: preset === "snow" ? 12 : 6, emitters: [emitter] };
}
/** Strict import boundary: never spread arbitrary JSON into runtime data. */
export function parseProject(raw: unknown): ParticleProject {
  const object = (v: unknown, label: string): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label}格式不正确`);
    return v as Record<string, unknown>;
  };
  const number = (v: unknown, label: string, min: number, max: number, integer = false) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new Error(`${label}应为 ${min}～${max} 的${integer ? "整数" : "数字"}`);
    return v;
  };
  const text = (v: unknown, label: string) => {
    if (typeof v !== "string" || !v.trim() || v.length > 100) throw new Error(`${label}应为 1～100 字的文本`);
    return v;
  };
  const bool = (v: unknown, label: string) => { if (typeof v !== "boolean") throw new Error(`${label}应为布尔值`); return v; };
  const range = (v: unknown, label: string, min: number, max: number): Range => {
    const r = object(v, label), result = { min: number(r.min, label, min, max), max: number(r.max, label, min, max) };
    if (result.min > result.max) throw new Error(`${label}的最小值不能大于最大值`);
    return result;
  };
  const point = (v: unknown, label: string): Point => { const p = object(v, label); return { x: number(p.x, label, -5000, 5000), y: number(p.y, label, -5000, 5000) }; };
  const color = (v: unknown): ColorRGBA => { const c = object(v, "颜色"); return { r: number(c.r, "红色", 0, 255), g: number(c.g, "绿色", 0, 255), b: number(c.b, "蓝色", 0, 255), a: number(c.a, "透明度", 0, 1) }; };
  const curve = (v: unknown, label: string, max: number): CurveKey[] => {
    if (!Array.isArray(v) || v.length < 2 || v.length > 16) throw new Error(`${label}需要 2～16 个关键点`);
    const keys = v.map(k => { const p = object(k, label); return { t: number(p.t, label, 0, 1), value: number(p.value, label, 0, max) }; });
    if (keys[0].t !== 0 || keys[keys.length - 1].t !== 1 || keys.some((k, i) => i > 0 && k.t <= keys[i - 1].t)) throw new Error(`${label}必须从 0 到 1 严格递增`);
    return keys;
  };
  const p = object(raw, "工程");
  if (p.schema !== PARTICLE_SCHEMA) throw new Error("不支持的粒子工程版本");
  if (!Array.isArray(p.emitters) || !p.emitters.length || p.emitters.length > 8) throw new Error("工程需要 1～8 个发射器");
  const emitters = p.emitters.map((v): ParticleEmitter => {
    const e = object(v, "发射器");
    if (!["point", "circle", "ring", "box"].includes(e.shape as string) || !["velocity", "bezier"].includes(e.motion as string)) throw new Error("不支持的发射形状或运动模式");
    return {
      id: text(e.id, "发射器 ID"), name: text(e.name, "发射器名称"), enabled: bool(e.enabled, "启用状态"),
      seed: number(e.seed, "随机种子", 1, 2147483646, true), imageId: e.imageId === null ? null : number(e.imageId, "图片 ID", 1, 2147483647, true),
      origin: point(e.origin, "发射位置"), delay: number(e.delay, "延迟", 0, 60), duration: number(e.duration, "周期", .1, 60), loop: bool(e.loop, "循环"),
      maxParticles: number(e.maxParticles, "粒子上限", 1, 512, true), rate: number(e.rate, "发射速率", 0, 200), burst: number(e.burst, "爆发数量", 0, 512, true),
      lifetime: range(e.lifetime, "寿命", .05, 30), size: range(e.size, "尺寸", 1, 300), speed: range(e.speed, "速度", 0, 2000),
      angle: number(e.angle, "方向", -360, 360), spread: number(e.spread, "散射角", 0, 360),
      rotation: range(e.rotation, "初始角度", -360, 360), spin: range(e.spin, "角速度", -720, 720),
      shape: e.shape as ParticleEmitter["shape"], radius: number(e.radius, "半径", 0, 2000), width: number(e.width, "区域宽度", 0, 4000), height: number(e.height, "区域高度", 0, 4000),
      motion: e.motion as ParticleEmitter["motion"], gravity: point(e.gravity, "加速度"), control1: point(e.control1, "控制点一"), control2: point(e.control2, "控制点二"), target: point(e.target, "终点"),
      sizeCurve: curve(e.sizeCurve, "大小曲线", 3), alphaCurve: curve(e.alphaCurve, "透明度曲线", 1), startColor: color(e.startColor), endColor: color(e.endColor),
    };
  });
  if (new Set(emitters.map(e => e.id)).size !== emitters.length) throw new Error("发射器 ID 重复");
  if (emitters.reduce((sum, e) => sum + e.maxParticles, 0) > MAX_CONTROLS) throw new Error(`工程的控件预算不能超过 ${MAX_CONTROLS}`);
  return { schema: PARTICLE_SCHEMA, name: text(p.name, "工程名称"), width: number(p.width, "画布宽度", 320, 3840, true), height: number(p.height, "画布高度", 240, 2160, true), previewDuration: number(p.previewDuration, "预览时长", .1, 120), emitters };
}

