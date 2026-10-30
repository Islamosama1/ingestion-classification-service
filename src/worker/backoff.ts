// Wait before retrying after the given attempt failed: doubles each time
// (base, 2·base, 4·base …) and never exceeds max.
export function retryDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  // 2^30 already dwarfs any sane cap; stops Infinity for huge attempts.
  const doublings = Math.min(Math.max(attempt, 1) - 1, 30);
  return Math.min(maxMs, baseMs * 2 ** doublings);
}
