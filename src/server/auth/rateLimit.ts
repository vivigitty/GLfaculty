/**
 * In-memory failed-login throttle (single application instance by design).
 * After MAX_FAILURES within WINDOW_MS a key is locked for LOCK_MS.
 */
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;
const MAX_FAILURES = 5;

type Entry = { failures: number[]; lockedUntil: number };
const g = globalThis as unknown as { __rtsRate?: Map<string, Entry> };
const buckets: Map<string, Entry> = (g.__rtsRate ??= new Map());

export function isLocked(keys: string[], now = Date.now()): boolean {
  return keys.some((k) => (buckets.get(k)?.lockedUntil ?? 0) > now);
}

export function recordFailure(keys: string[], now = Date.now()): void {
  for (const k of keys) {
    const e = buckets.get(k) ?? { failures: [], lockedUntil: 0 };
    e.failures = e.failures.filter((t) => now - t < WINDOW_MS);
    e.failures.push(now);
    if (e.failures.length >= MAX_FAILURES) {
      e.lockedUntil = now + LOCK_MS;
      e.failures = [];
    }
    buckets.set(k, e);
  }
}

export function recordSuccess(keys: string[]): void {
  for (const k of keys) buckets.delete(k);
}

export function resetRateLimits(): void {
  buckets.clear();
}
