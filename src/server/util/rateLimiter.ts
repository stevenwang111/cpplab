/**
 * Token bucket keyed by client address. The bucket is small and in-memory:
 * the deployment target is a single process with fewer than ten users.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
  ) {}

  take(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, updated: now };
    const elapsed = (now - bucket.updated) / 1000;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.ratePerSecond);
    bucket.updated = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  /** Drop buckets that have completely refilled; no timer needed. */
  sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updated > 60_000) this.buckets.delete(key);
    }
  }
}
