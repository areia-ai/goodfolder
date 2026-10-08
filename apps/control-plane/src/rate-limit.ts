/**
 * In-memory sliding-window limiter — single container, stopgap-grade.
 *
 * When a named bucket fills, keys whose hits all expired are dropped first.
 * If it is still full, a brand-new key passes untracked — one free request —
 * instead of evicting a record that is still live. A flood of junk keys can
 * never lift the limit on a key that is actually being refused, which a
 * full wipe or oldest-key eviction would do.
 */
export function makeRateLimiter(cap = 10_000) {
  const buckets = new Map<string, Map<string, number[]>>();
  return function rateLimit(name: string, key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = new Map();
      buckets.set(name, bucket);
    }
    const hits = (bucket.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      // A refused check still touches the key, keeping its record fresh.
      bucket.delete(key);
      bucket.set(key, hits);
      return false;
    }
    if (!bucket.has(key) && bucket.size >= cap) {
      for (const [k, seen] of bucket) {
        if (!seen.length || now - seen[seen.length - 1]! >= windowMs) bucket.delete(k);
      }
      if (bucket.size >= cap) return true;
    }
    hits.push(now);
    bucket.delete(key);
    bucket.set(key, hits);
    return true;
  };
}
