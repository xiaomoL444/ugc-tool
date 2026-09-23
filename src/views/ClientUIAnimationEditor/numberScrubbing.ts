export interface NumberScrubOptions {
  min?: number;
  max?: number;
  step?: number;
  /** 每移动一像素改变的数值；独立于输入精度。 */
  scrubSpeed?: number;
}

export function getNumberScrubSpeed(options: NumberScrubOptions) {
  if (Number.isFinite(options.scrubSpeed) && options.scrubSpeed! > 0) {
    return options.scrubSpeed!;
  }
  if (Number.isFinite(options.min) && Number.isFinite(options.max) && options.max! > options.min!) {
    // 有限范围默认用约 200px 横向拖动走完，而非所有参数共用小数步幅。
    return (options.max! - options.min!) / 200;
  }
  return Math.max(getNumberScrubStep(options), 1);
}

export function getNumberScrubStep(options: NumberScrubOptions) {
  return Number.isFinite(options.step) && options.step! > 0 ? options.step! : 1;
}

export function clampNumberScrubValue(value: number, options: NumberScrubOptions) {
  if (Number.isFinite(options.min)) value = Math.max(options.min!, value);
  if (Number.isFinite(options.max)) value = Math.min(options.max!, value);
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function advanceNumberScrub(
  accumulatedValue: number,
  deltaX: number,
  options: NumberScrubOptions,
  modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
) {
  const multiplier = modifiers.shiftKey ? 0.1 : modifiers.ctrlKey || modifiers.metaKey ? 10 : 1;
  const precision = getNumberScrubStep(options) * (modifiers.shiftKey ? 0.1 : 1);
  // 逐次累计相对移动，切换修饰键不会重新缩放之前的整段拖动。
  // 在边界处丢弃超出的累计量，往回拖一小段即可离开边界。
  const accumulated = clampNumberScrubValue(
    accumulatedValue + deltaX * getNumberScrubSpeed(options) * multiplier,
    options,
  );
  return {
    accumulated,
    value: clampNumberScrubValue(Math.round(accumulated / precision) * precision, options),
  };
}
