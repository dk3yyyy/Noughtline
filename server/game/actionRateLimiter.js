class ActionRateLimiter {
  constructor({ limit = 30, windowMs = 60_000, now = () => Date.now() } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error('windowMs must be a positive integer');
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  consume(key) {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }

    if (entry.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfterMs: Math.max(1, entry.resetAt - now),
      };
    }

    entry.count += 1;
    return {
      allowed: true,
      remaining: this.limit - entry.count,
      resetAt: entry.resetAt,
    };
  }

  prune() {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt > now) continue;
      this.entries.delete(key);
      removed += 1;
    }
    return removed;
  }
}

module.exports = { ActionRateLimiter };
