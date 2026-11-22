import { config } from '../config.js';
import { RateLimiter } from './rateLimiter.js';

/**
 * Per-account concurrency slots. Global semaphores remain the hard ceiling;
 * these stop one account from occupying the whole queue (AGENTS.md §7).
 */
export class UserSlots {
  private readonly active = new Map<string, number>();

  constructor(private readonly perUser: number) {}

  tryAcquire(userId: string): (() => void) | null {
    const current = this.active.get(userId) ?? 0;
    if (current >= this.perUser) return null;
    this.active.set(userId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = Math.max(0, (this.active.get(userId) ?? 1) - 1);
      if (next === 0) this.active.delete(userId);
      else this.active.set(userId, next);
    };
  }

  activeFor(userId: string): number {
    return this.active.get(userId) ?? 0;
  }
}

export const userRunSlots = new UserSlots(config.limits.userRuns);
export const userDebugSlots = new UserSlots(config.limits.userDebugSessions);

/** Per-user request rate limit, keyed by account rather than IP (§9). */
export const userRequestLimiter = new RateLimiter(
  config.limits.userRateLimitPerSecond,
  config.limits.userRateLimitBurst,
);
