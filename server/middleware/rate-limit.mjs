/**
 * In-memory fixed-window rate limiter, keyed by client IP (issue #22,
 * PLAN.md section 7: "rate limits on submission and report endpoints").
 *
 * Single-replica limitation: state does not survive a restart and is not
 * shared across replicas. Acceptable at MVP scale (no autoscaling
 * configured for this service yet); revisit with a shared store (e.g. a
 * Postgres-backed counter) if the service scales beyond one replica.
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 10;

const hits = new Map(); // key -> { count, resetAt }

function clientKey(c) {
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return c.req.header("x-real-ip") || "unknown";
}

export function rateLimit({ windowMs = WINDOW_MS, max = MAX_REQUESTS } = {}) {
  return async (c, next) => {
    const key = clientKey(c);
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    await next();
  };
}
