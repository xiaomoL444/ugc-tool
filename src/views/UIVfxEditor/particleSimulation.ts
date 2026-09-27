import type { ParticleEmitter, CurveKey, Point, Range } from "./particleModel";
import type { ColorRGBA } from "../ClientUIAnimationEditor/types";
export interface ParticleFrame { ordinal: number; slot: number; x: number; y: number; size: number; rotation: number; color: ColorRGBA }
export const EPSILON = 1e-9;
const radians = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Integer arithmetic remains exact in both JS doubles and Lua 5.3. */
export function particleRandom(seed: number, ordinal: number): () => number {
  let state = (seed + ((ordinal + 1) % 2147483646) * 48271) % 2147483647;
  if (state < 1) state = 1;
  return () => { state = state * 16807 % 2147483647; return (state - 1) / 2147483646; };
}
export function evaluateCurve(keys: CurveKey[], t: number): number {
  if (t <= keys[0].t) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) return lerp(keys[i - 1].value, keys[i].value, (t - keys[i - 1].t) / (keys[i].t - keys[i - 1].t));
  }
  return keys[keys.length - 1].value;
}
export function bezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}
/** Absolute-time sampling makes pause/seek/replay independent of frame rate.
 * Slots are reused in birth order; a full pool replaces its oldest slot. */
export function sampleEmitter(e: ParticleEmitter, time: number): ParticleFrame[] {
  if (!e.enabled || !Number.isFinite(time) || time < e.delay) return [];
  const local = time - e.delay;
  // Merge continuous births and periodic bursts backwards. Continuous rate does
  // not restart each cycle; this also preserves fractional rates across loops.
  let continuous = e.rate > 0 ? Math.floor(local * e.rate + EPSILON) + 1 : 0;
  if (!e.loop) continuous = Math.min(continuous, Math.max(0, Math.ceil(e.duration * e.rate - EPSILON)));
  let bursts = (e.loop ? Math.floor(local / e.duration) + 1 : 1) * e.burst;
  const last = continuous + bursts - 1;
  const frames: ParticleFrame[] = [];
  for (let ordinal = last; ordinal >= Math.max(0, last - e.maxParticles + 1); ordinal--) {
    const rateBirth = continuous > 0 ? (continuous - 1) / e.rate : -Infinity;
    const burstBirth = bursts > 0 ? Math.floor((bursts - 1) / e.burst) * e.duration : -Infinity;
    // At equal times, the burst is born first and the continuous particle last.
    const fromRate = rateBirth >= burstBirth - EPSILON;
    const birth = fromRate ? rateBirth : burstBirth;
    if (fromRate) continuous--; else bursts--;
    const age = local - birth;
    const random = particleRandom(e.seed, ordinal);
    const pick = (r: Range) => lerp(r.min, r.max, random());
    const life = pick(e.lifetime), speed = pick(e.speed), baseSize = pick(e.size);
    const rotation = pick(e.rotation), spin = pick(e.spin);
    const direction = (e.angle + (random() - .5) * e.spread) * radians;
    const shapeAngle = random() * Math.PI * 2, shapeRadius = random(), boxX = random(), boxY = random();
    if (age < -EPSILON || age >= life) continue;
    let start: Point = { x: 0, y: 0 };
    if (e.shape === "circle" || e.shape === "ring") {
      const radius = e.radius * (e.shape === "ring" ? 1 : Math.sqrt(shapeRadius));
      start = { x: Math.cos(shapeAngle) * radius, y: Math.sin(shapeAngle) * radius };
    } else if (e.shape === "box") start = { x: (boxX - .5) * e.width, y: (boxY - .5) * e.height };
    const t = Math.max(0, age) / life;
    const position = e.motion === "bezier" ? bezierPoint(t, start, e.control1, e.control2, e.target) : {
      x: start.x + Math.cos(direction) * speed * age + .5 * e.gravity.x * age * age,
      y: start.y + Math.sin(direction) * speed * age + .5 * e.gravity.y * age * age,
    };
    const alpha = evaluateCurve(e.alphaCurve, t);
    frames.push({ ordinal, slot: ordinal % e.maxParticles, x: e.origin.x + position.x, y: e.origin.y + position.y,
      size: baseSize * evaluateCurve(e.sizeCurve, t), rotation: rotation + spin * age,
      color: { r: lerp(e.startColor.r, e.endColor.r, t), g: lerp(e.startColor.g, e.endColor.g, t), b: lerp(e.startColor.b, e.endColor.b, t), a: lerp(e.startColor.a, e.endColor.a, t) * alpha },
    });
  }
  return frames.reverse();
}


