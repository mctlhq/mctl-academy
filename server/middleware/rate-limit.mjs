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
 *
 * Observability: trusting a single header makes its *absence* a silent
 * failure mode -- if `CF-Connecting-IP` ever stops arriving (direct origin
 * access, a proxy reconfiguration, Cloudflare bypassed), every anonymous
 * caller collapses into the one shared no-IP bucket and the endpoint starts
 * returning 429 site-wide after `max` requests per window. That is the
 * intended fail-closed behaviour, but until now it left no trace: neither
 * this middleware nor the app logged anything about rejections, so the
 * condition was invisible in Loki. Both the no-IP fallback and every 429 are
 * therefore logged, throttled so that a flood cannot turn the log itself
 * into the outage.
 */

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX) || 10;
// Bounds the shared Map's memory footprint: without a cap, a flood of
// distinct client IPs grows `hits` without limit for the life of the
// process (it is only ever cleaned up lazily, per key, on that key's own
// next request).
const MAX_ENTRIES = Number(process.env.RATE_LIMIT_MAX_ENTRIES) || 5000;
const TRUSTED_IP_HEADER = "cf-connecting-ip";
// Shortest gap between two log lines of the same kind. The conditions worth
// logging here are exactly the ones that can repeat at request rate (a
// missing header affects every request; a client past its quota keeps
// retrying), so an unthrottled line per occurrence would be both useless and
// a log-volume amplifier handed to any caller.
const LOG_INTERVAL_MS = Number(process.env.RATE_LIMIT_LOG_INTERVAL_MS) || 60 * 1000;

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

/**
 * Per-event log throttle. Returns a function that, for a given event name,
 * either grants permission to log now -- reporting how many occurrences were
 * swallowed since the last granted line, so a throttled log never
 * misrepresents a flood as a single event -- or returns null.
 */
function createLogThrottle({ intervalMs, now }) {
  const perEvent = new Map(); // event -> { nextAt, suppressed }

  return function claim(event) {
    const currentTime = now();
    let state = perEvent.get(event);
    if (!state) {
      state = { nextAt: 0, suppressed: 0 };
      perEvent.set(event, state);
    }
    if (currentTime < state.nextAt) {
      state.suppressed += 1;
      return null;
    }
    const { suppressed } = state;
    state.suppressed = 0;
    state.nextAt = currentTime + intervalMs;
    return { suppressed };
  };
}

function since(claimed) {
  return claimed.suppressed > 0 ? ` (+${claimed.suppressed} suppressed since last line)` : "";
}

export function rateLimit({
  windowMs = WINDOW_MS,
  max = MAX_REQUESTS,
  maxEntries = MAX_ENTRIES,
  trustedIpHeader = TRUSTED_IP_HEADER,
  logIntervalMs = LOG_INTERVAL_MS,
  now = Date.now,
  logger = console,
  store = new Map(), // key -> { count, resetAt }
} = {}) {
  const claimLog = createLogThrottle({ intervalMs: logIntervalMs, now });

  return async (c, next) => {
    const key = clientKey(c, trustedIpHeader);
    const currentTime = now();

    if (key === NO_IP_KEY) {
      // The diagnostic this whole file's trust model rests on: in production
      // every request reaches the origin through Cloudflare, so this line
      // should never appear. If it does, the header is not arriving and one
      // bucket is standing in for every anonymous client.
      const claimed = claimLog("no-trusted-ip");
      if (claimed) {
        logger.warn(
          `[rate-limit] no ${trustedIpHeader} header on ${c.req.method} ${c.req.path}; ` +
            `all such requests share a single bucket${since(claimed)}`,
        );
      }
    }
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
          // Distinct from the quota rejection below and far more alarming:
          // this turns away a client that has made no requests at all,
          // because the store is genuinely full of live windows.
          const claimed = claimLog("capacity");
          if (claimed) {
            logger.warn(
              `[rate-limit] rejected ${c.req.method} ${c.req.path}: store at capacity ` +
                `(${store.size}/${maxEntries} live windows), no room for a new client${since(claimed)}`,
            );
          }
          return c.json({ error: "Too many requests. Please try again later." }, 429);
        }
      }
      entry = { count: 0, resetAt: currentTime + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      // The bucket kind, never the IP itself: knowing *that* a shared no-IP
      // bucket is doing the rejecting is the operational signal, and logging
      // caller addresses would put personal data into Loki for no added
      // diagnostic value.
      const isNoIp = key === NO_IP_KEY;
      const bucket = isNoIp ? "the shared no-IP bucket" : "a per-IP bucket";
      // Throttled as two separate events, not one "quota": a single client
      // hammering its own bucket would otherwise hold the shared token and
      // fold every site-wide rejection into its own line's suppressed count,
      // hiding exactly the condition this logging exists to surface.
      const claimed = claimLog(isNoIp ? "quota:no-ip" : "quota:per-ip");
      if (claimed) {
        logger.warn(
          `[rate-limit] rejected ${c.req.method} ${c.req.path}: ${bucket} exceeded ` +
            `${max} requests per ${windowMs}ms${since(claimed)}`,
        );
      }
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    await next();
  };
}
