export class FixedWindowLimiter {
  constructor({ limit, windowMs, maxKeys = 10_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }

  consume(key, now = Date.now()) {
    let entry = this.entries.get(key);
    if (entry && now - entry.startedAt >= this.windowMs) {
      this.entries.delete(key);
      entry = null;
    }
    if (!entry) {
      if (this.entries.size >= this.maxKeys) {
        for (const [storedKey, stored] of this.entries) {
          if (now - stored.startedAt >= this.windowMs) this.entries.delete(storedKey);
        }
      }
      if (this.entries.size >= this.maxKeys) return { allowed: false, retryAfterSeconds: 1 };
      entry = { count: 0, startedAt: now };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.count <= this.limit) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + this.windowMs - now) / 1000)),
    };
  }
}
