import { now } from "./utils.js";

export class TokenBucketRateLimiter {
  constructor({ capacity = 30, refillPerSecond = 15 } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.entries = new Map();
  }

  allow(key, cost = 1) {
    const current = now();
    const existing = this.entries.get(key) || {
      tokens: this.capacity,
      updatedAt: current
    };

    const elapsedSeconds = Math.max(0, current - existing.updatedAt) / 1000;
    existing.tokens = Math.min(
      this.capacity,
      existing.tokens + elapsedSeconds * this.refillPerSecond
    );
    existing.updatedAt = current;

    if (existing.tokens < cost) {
      this.entries.set(key, existing);
      return false;
    }

    existing.tokens -= cost;
    this.entries.set(key, existing);
    return true;
  }
}
