/* Reservations are upper bounds. Confirmed usage never includes the reservation safety margin. */
export function usageCostMicros(usage, config, inputLimit, outputLimit) {
  const input = usage?.prompt_tokens, output = usage?.completion_tokens;
  if (!Number.isSafeInteger(input) || input < 0 || input > inputLimit
    || !Number.isSafeInteger(output) || output < 0 || output > outputLimit) return null;
  const cached = usage.prompt_cache_hit_tokens;
  // A malformed optional cache breakdown cannot grant a discount.
  const cachedInput = Number.isSafeInteger(cached) && cached >= 0 && cached <= input ? cached : 0;
  const cachedRate = config.cachedInputRate ?? config.inputRate;
  const cost = Math.ceil((input - cachedInput) * config.inputRate + cachedInput * cachedRate + output * config.outputRate);
  return Number.isSafeInteger(cost) && cost >= 0 ? cost : null;
}
