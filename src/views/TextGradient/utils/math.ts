export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function lcm(a: number, b: number): number {
  let result = Math.abs(a * b) / gcd(a, b);
  return Number.isNaN(result) ? 0 : result;
}
