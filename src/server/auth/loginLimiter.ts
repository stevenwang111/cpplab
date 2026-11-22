import { config } from '../config.js';

interface Counter {
  windowStart: number;
  count: number;
}

interface FailureState {
  count: number;
  blockedUntil: number;
}

interface CounterResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** One fixed-window counter; small and in-memory by design (single process). */
class WindowCounter {
  private readonly entries = new Map<string, Counter>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now: number): CounterResult {
    const current = this.entries.get(key);
    if (!current || now - current.windowStart >= this.windowMs) {
      this.entries.set(key, { windowStart: now, count: 1 });
      return { allowed: this.limit >= 1, retryAfterSeconds: 0 };
    }
    if (current.count >= this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.windowStart + this.windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  sweep(now: number): void {
    for (const [key, value] of this.entries) {
      if (now - value.windowStart > this.windowMs * 2) this.entries.delete(key);
    }
  }
}

const BACKOFF_STEPS_MS = [60_000, 5 * 60_000, 15 * 60_000];

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Login protection runs *before* scrypt:
 *   - IP: 10 attempts / minute
 *   - username: 5 attempts / minute
 *   - consecutive failures add a 1m → 5m → 15m cooldown, never a permanent lock
 */
export class LoginLimiter {
  private readonly byIp = new WindowCounter(config.limits.loginIpPerMinute, 60_000);
  private readonly byUsername = new WindowCounter(config.limits.loginUserPerMinute, 60_000);
  private readonly failures = new Map<string, FailureState>();

  check(ip: string, username: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const userKey = normalizeUsername(username);
    const failure = this.failures.get(userKey);
    if (failure && failure.blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((failure.blockedUntil - now) / 1000)) };
    }
    const ipResult = this.byIp.take(`ip:${ip}`, now);
    if (!ipResult.allowed) return ipResult;
    return this.byUsername.take(`user:${userKey}`, now);
  }

  recordSuccess(username: string): void {
    const key = normalizeUsername(username);
    this.failures.delete(key);
    // A successful login ends the brute-force window for this account; the IP
    // window still counts attempts to bound request volume.
    this.byUsername.reset(`user:${key}`);
  }

  recordFailure(username: string, now = Date.now()): void {
    const key = normalizeUsername(username);
    const previous = this.failures.get(key) ?? { count: 0, blockedUntil: 0 };
    const count = previous.count + 1;
    let blockedUntil = previous.blockedUntil;
    if (count % 5 === 0) {
      const step = Math.min(BACKOFF_STEPS_MS.length - 1, Math.floor(count / 5) - 1);
      blockedUntil = now + BACKOFF_STEPS_MS[step];
    }
    this.failures.set(key, { count, blockedUntil });
  }

  sweep(now = Date.now()): void {
    this.byIp.sweep(now);
    this.byUsername.sweep(now);
    for (const [key, value] of this.failures) {
      if (value.blockedUntil < now - 15 * 60_000) this.failures.delete(key);
    }
  }

  /** Test hook: lets unit tests start from a clean limiter. */
  reset(): void {
    this.failures.clear();
  }
}

export const loginLimiter = new LoginLimiter();
