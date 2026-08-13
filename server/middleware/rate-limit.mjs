/**
 * Bounded, trusted-proxy-aware fixed-window rate limiter, keyed by client IP
 * (issue #22, PLAN.md section 7: "rate limits on submission and report
 * endpoints").
 *
 * academy.mctl.ai is fronted by Cloudflare (every response carries
 * `server: cloudflare`), which unconditionally overwrites `CF-Connecting-IP`
 * with the TCP peer it actually saw -- a client cannot make that header lie.
 * `X-Forwarded-For` does not have that property: a reverse proxy typically
 * only *appends* to it (nginx's `$proxy_add_x_forwarded_for`), so whatever a
 * client sent under that name survives as the first, attacker-controlled
 * entry. The previous implementation trusted exactly that spoofable prefix,
 * so any client could pick its own rate-limit bucket (or a fresh one per
 * request) at will. `CF-Connecting-IP` is the only header this limiter
 * reads for client identity.
 *
 * Single-replica limitation: state does not survive a restart and is not
 * shared across replicas. Acceptable at MVP scale (no autoscaling
 * configured for this service yet); revisit with a shared store (e.g. a
 * Postgres-backed counter) if the service scales beyond one replica.
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 10;
// Bounds the shared Map's memory footprint: without a cap, a flood of
// distinct client IPs grows `hits` without limit for the life of the
// process (it is only ever cleaned up lazily, per key, on that key's own
// next request).
const MAX_ENTRIES = Number(process.env.RATE_LIMIT_MAX_ENTRIES) || 5000;
const TRUSTED_IP_HEADER = "cf-connecting-ip";

// A Symbol, never a string: header values are always strings, so this key
// can never be produced by any request, spoofed or not. Requests with no
// trusted IP header therefore land in one dedicated bucket that is
// impossible to collide with -- a client cannot, say, send
// `CF-Connecting-IP: unknown` to piggyback on (or grief) whatever bucket
// genuinely IP-less requests share.
const NO_IP_KEY = Symbol("no-trusted-ip");

function clientKey(c, trustedIpHeader) {
  const ip = c.req.header(trustedIpHeader);
  return ip ? ip.trim() : NO_IP_KEY;
}

/**
 * Removes every expired entry from `store`. Only called when the store is
 * already at capacity and about to turn away a brand-new key -- an O(n)
 * sweep on every single request would be wasted work almost all the time;
 * paying it right before a capacity decision reclaims space from a store
 * that is "full" merely because nothing has touched its stale entries yet,
 * rather than one genuinely serving `maxEntries` live windows at once.
 */
function evictExpired(store, currentTime) {
  for (const [key, entry] of store) {
    if (entry.resetAt <= currentTime) store.delete(key);
  }
}

export function rateLimit({
  windowMs = WINDOW_MS,
  max = MAX_REQUESTS,
  maxEntries = MAX_ENTRIES,
  trustedIpHeader = TRUSTED_IP_HEADER,
  now = Date.now,
  store = new Map() // key -> { count, resetAt }
} = {}) {
  return async (c, next) => {
    const key = clientKey(c, trustedIpHeader);
    const currentTime = now();
    let entry = store.get(key);
    const isNewKey = !entry || entry.resetAt <= currentTime;

    if (isNewKey) {
      // Only a genuinely new map slot needs capacity: reusing an existing
      // (if expired) key's slot never grows the store. Evicting some other
      // key's still-active window to make room would hand that client an
      // unearned reset, so a store still full after the sweep fails closed
      // instead.
      if (!store.has(key) && store.size >= maxEntries) {
        evictExpired(store, currentTime);
        if (store.size >= maxEntries) {
          return c.json({ error: "Too many requests. Please try again later." }, 429);
        }
      }
      entry = { count: 0, resetAt: currentTime + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    await next();
  };
}
