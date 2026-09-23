import { applyTweenEase } from "./tweenRegistry";
import type { TweenEaseType } from "./types";

/** Shared axes leave room for Back/Elastic overshoot instead of clipping it. */
export function easeCurvePath(ease: TweenEaseType): string {
  return Array.from({ length: 161 }, (_, index) => {
    const t = index / 160;
    return `${index ? "L" : "M"}${(16 + t * 128).toFixed(2)},${(100 - applyTweenEase(ease, t) * 72).toFixed(2)}`;
  }).join(" ");
}
