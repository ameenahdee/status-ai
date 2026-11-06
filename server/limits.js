// In-memory limiters (per process). Fine for a single-instance MVP; use a shared store to scale out.

// Sliding-window per-IP limiter. Idle IPs are pruned so memory cannot grow without bound.
export function createRateLimiter({ max = 8, windowMs = 60_000 } = {}) {
  const hits = new Map()
  return {
    // Records a hit; returns true if this IP is now over the limit.
    check(ip, now = Date.now()) {
      const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs)
      recent.push(now)
      hits.set(ip, recent)
      return recent.length > max
    },
    // Drops IPs whose hits have all expired.
    prune(now = Date.now()) {
      for (const [ip, times] of hits) {
        const recent = times.filter((t) => now - t < windowMs)
        if (recent.length) hits.set(ip, recent)
        else hits.delete(ip)
      }
    },
    get size() {
      return hits.size
    },
  }
}

// Global cap on live AI generations per UTC day, protecting the shared free-tier quota.
export function createDailyCap(cap) {
  let day = ''
  let used = 0
  return {
    // Returns true if a request may proceed (and counts it); false once the cap is reached.
    take(now = Date.now()) {
      const today = new Date(now).toISOString().slice(0, 10)
      if (today !== day) {
        day = today
        used = 0
      }
      if (used >= cap) return false
      used += 1
      return true
    },
    get used() {
      return used
    },
    cap,
  }
}

// Positive integer from an env string, otherwise the fallback.
export function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
