import { retryDelayMs } from '../../../src/worker/backoff';

describe('retryDelayMs (exponential, capped)', () => {
  const base = 1000;
  const cap = 60000;

  it.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [4, 8000],
    [6, 32000],
  ])('after attempt %i → wait %i ms', (attempt, ms) => {
    expect(retryDelayMs(attempt, base, cap)).toBe(ms);
  });

  it('never exceeds the cap', () => {
    expect(retryDelayMs(7, base, cap)).toBe(60000);
    expect(retryDelayMs(50, base, cap)).toBe(60000);
  });

  it('huge attempt numbers do not overflow', () => {
    expect(retryDelayMs(10_000, base, cap)).toBe(60000);
  });

  it('attempt 0 or below is treated as the first', () => {
    expect(retryDelayMs(0, base, cap)).toBe(1000);
  });
});
