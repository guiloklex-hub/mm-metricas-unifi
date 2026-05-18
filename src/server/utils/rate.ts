/**
 * Calcula uma taxa numerator/denominator com tolerância para denominador zero/null/undefined.
 * Retorna null quando indefinido para preservar essa informação no banco.
 */
export function rate(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (numerator == null || denominator == null) return null;
  if (denominator <= 0) return null;
  if (numerator < 0) return null;
  return numerator / denominator;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
