import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { rateLimit } from "../server/middleware/rate-limit.mjs";

// A throwaway probe app per test, never server/app.mjs -- the middleware
// itself has no DB dependency, and keeping these tests off the real app
// means no shared rate-limit store leaks between them or requires a live
// Postgres connection.
//
// The logger is always injected, never the real console: it keeps the suite's
// output clean, and makes the warnings themselves assertable rather than
// something a human has to notice scrolling past.
function probeApp(options = {}) {
  const logs = [];
  const app = new Hono();
  app.post("/probe", rateLimit({ logger: { warn: (message) => logs.push(message) }, ...options }), (c) =>
    c.json({ ok: true }),
  );
  return { app, logs };
}

function clock(startMs) {
  let current = startMs;
  return { now: () => current, advance: (ms) => (current += ms) };
}

describe("rateLimit — trusted IP source (PLAN.md PR 2b)", () => {
  test("trusts only CF-Connecting-IP: two different values get independent budgets", async () => {
    const { app } = probeApp({ max: 1, store: new Map() });

    const first = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });
    const second = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.2" },
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const firstAgain = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });
    assert.equal(firstAgain.status, 429);
  });

  test("a spoofed X-Forwarded-For is never read as client identity", async () => {
    const { app } = probeApp({ max: 1, store: new Map() });

    const first = await app.request("/probe", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    assert.equal(first.status, 200);

    // Different spoofed X-Forwarded-For, still no cf-connecting-ip: this is
    // the *same* untrusted request from the middleware's point of view, so
    // it must land in the same bucket as the first and be rejected --
    // proving X-Forwarded-For cannot be used to fabricate a fresh identity.
    const second = await app.request("/probe", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.2" },
    });
    assert.equal(second.status, 429);
  });

  test("a literal 'unknown' header value gets its own bucket, distinct from a genuinely missing header", async () => {
    const { app } = probeApp({ max: 1, store: new Map() });

    const literalUnknown = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "unknown" },
    });
    assert.equal(literalUnknown.status, 200);

    // No cf-connecting-ip at all -- must not have been consumed by the
    // request above, which set the header to the literal string "unknown"
    // rather than omitting it.
    const trulyMissing = await app.request("/probe", { method: "POST", headers: {} });
    assert.equal(trulyMissing.status, 200);
  });
});

describe("rateLimit — bounded storage (PLAN.md PR 2b)", () => {
  test("capacity exhaustion fails closed instead of evicting an active entry", async () => {
    const store = new Map();
    const { app } = probeApp({ max: 10, maxEntries: 2, store });

    const a = await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.1" } });
    const b = await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.2" } });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(store.size, 2);

    // A third, brand-new key with the store already at maxEntries: must be
    // rejected rather than silently evicting 10.0.0.1's still-active entry.
    const c = await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.3" } });
    assert.equal(c.status, 429);
    assert.equal(store.size, 2);
    assert.ok(store.has("10.0.0.1"), "an active entry must not be evicted to make room");
    assert.ok(store.has("10.0.0.2"), "an active entry must not be evicted to make room");

    // 10.0.0.1's own budget must be untouched by the rejected newcomer.
    const aAgain = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "10.0.0.1" },
    });
    assert.equal(aAgain.status, 200);
  });

  test("expired entries are swept before a capacity-exhausted request fails closed", async () => {
    const store = new Map();
    const { now, advance } = clock(1_000_000);
    const { app } = probeApp({ max: 10, maxEntries: 2, windowMs: 1000, store, now });

    await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.1" } });
    await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.2" } });
    assert.equal(store.size, 2);

    advance(1001); // both entries are now expired

    const c = await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.3" } });
    assert.equal(c.status, 200, "the sweep should have reclaimed room for a new key");
    assert.equal(store.size, 1, "expired entries are removed, leaving only the new one");
    assert.ok(store.has("10.0.0.3"));
  });
});

describe("rateLimit — observability", () => {
  test("a missing trusted header is warned about, naming the header", async () => {
    const { app, logs } = probeApp({ max: 10, store: new Map() });

    const response = await app.request("/probe", { method: "POST", headers: {} });

    assert.equal(response.status, 200, "the warning must not change the outcome of the request");
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[rate-limit\]/);
    assert.match(logs[0], /cf-connecting-ip/);
  });

  test("nothing is logged on the production path, where the header arrives", async () => {
    const { app, logs } = probeApp({ max: 10, store: new Map() });

    await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1" } });
    await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.2" } });

    // The signal is only useful if it is silent when all is well: any line at
    // all in Loki then means the header genuinely stopped arriving.
    assert.deepEqual(logs, []);
  });

  test("a quota rejection is logged, and distinguishes a per-IP bucket from the shared one", async () => {
    const perIp = probeApp({ max: 1, store: new Map() });
    await perIp.app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1" } });
    const rejected = await perIp.app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.1" },
    });
    assert.equal(rejected.status, 429);
    assert.equal(perIp.logs.length, 1);
    assert.match(perIp.logs[0], /a per-IP bucket exceeded/);

    const noIp = probeApp({ max: 1, store: new Map() });
    await noIp.app.request("/probe", { method: "POST", headers: {} });
    const rejectedAnonymously = await noIp.app.request("/probe", { method: "POST", headers: {} });
    assert.equal(rejectedAnonymously.status, 429);
    // The site-wide failure mode this PR exists to make visible: the shared
    // bucket, not one client, is what ran out of budget.
    assert.ok(
      noIp.logs.some((line) => /the shared no-IP bucket exceeded/.test(line)),
      `expected a shared-bucket rejection line, got ${JSON.stringify(noIp.logs)}`,
    );
  });

  test("a capacity rejection is logged as its own, distinct condition", async () => {
    const { app, logs } = probeApp({ max: 10, maxEntries: 2, store: new Map() });

    await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.1" } });
    await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "10.0.0.2" } });
    const turnedAway = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "10.0.0.3" },
    });

    assert.equal(turnedAway.status, 429);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /store at capacity \(2\/2 live windows\)/);
  });

  test("repeated conditions are throttled per event, and report what was suppressed", async () => {
    const { now, advance } = clock(0);
    // windowMs far larger than the log interval so the rate-limit window
    // itself never rolls over mid-test: the only thing moving is the log
    // throttle.
    const { app, logs } = probeApp({ max: 1, windowMs: 600_000, logIntervalMs: 1000, store: new Map(), now });

    await app.request("/probe", { method: "POST", headers: {} }); // 200, warns about the missing header
    await app.request("/probe", { method: "POST", headers: {} }); // 429, warns about the quota
    await app.request("/probe", { method: "POST", headers: {} }); // both conditions recur, both suppressed
    await app.request("/probe", { method: "POST", headers: {} });

    assert.equal(logs.length, 2, `expected both first-occurrence lines only, got ${JSON.stringify(logs)}`);
    assert.match(logs[0], /no cf-connecting-ip header/);
    assert.match(logs[1], /exceeded/);
    assert.ok(
      logs.every((line) => !/suppressed/.test(line)),
      "a first line has nothing to report as suppressed",
    );

    advance(1000);
    await app.request("/probe", { method: "POST", headers: {} });

    assert.equal(logs.length, 4);
    // Three further requests hit the missing-header path (requests 2-4) and
    // two of them were also quota rejections beyond the one already logged.
    assert.match(logs[2], /\(\+3 suppressed since last line\)/);
    assert.match(logs[3], /\(\+2 suppressed since last line\)/);
  });

  test("a per-IP flood cannot suppress the shared no-IP rejection on the same instance", async () => {
    const { now } = clock(0);
    // One middleware instance, one store, one throttle -- the concurrency the
    // per-bucket tests above cannot exercise, since they each use their own
    // probe app.
    const { app, logs } = probeApp({
      max: 1,
      windowMs: 600_000,
      logIntervalMs: 600_000,
      store: new Map(),
      now,
    });

    // A single client hammering its own bucket, well inside the throttle
    // interval: it claims the per-IP quota token and keeps re-triggering it.
    await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1" } });
    for (let i = 0; i < 3; i += 1) {
      await app.request("/probe", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.1" } });
    }

    // Meanwhile the header stops arriving and legitimate traffic collapses
    // into the shared bucket. That rejection is the site-wide condition this
    // logging exists for, so a noisy neighbour must not fold it into its own
    // line's suppressed count.
    await app.request("/probe", { method: "POST", headers: {} });
    const sharedRejection = await app.request("/probe", { method: "POST", headers: {} });

    assert.equal(sharedRejection.status, 429);
    assert.ok(
      logs.some((line) => /the shared no-IP bucket exceeded/.test(line)),
      `the shared-bucket rejection must be logged in its own right, got ${JSON.stringify(logs)}`,
    );
  });

  test("throttling one event does not silence a different one", async () => {
    const { now } = clock(0);
    const { app, logs } = probeApp({
      max: 1,
      maxEntries: 1,
      windowMs: 600_000,
      logIntervalMs: 600_000,
      store: new Map(),
      now,
    });

    await app.request("/probe", { method: "POST", headers: {} }); // missing header: logged
    await app.request("/probe", { method: "POST", headers: {} }); // quota: logged
    // A brand-new key against a store already at maxEntries, well inside the
    // throttle interval of both events logged above.
    const turnedAway = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "10.0.0.9" },
    });

    assert.equal(turnedAway.status, 429);
    assert.equal(logs.length, 3);
    assert.match(logs[2], /store at capacity/);
  });
});

describe("rateLimit — window rollover", () => {
  test("an injected clock deterministically rolls the window over (regression)", async () => {
    const { now, advance } = clock(0);
    const { app } = probeApp({ max: 1, windowMs: 1000, store: new Map(), now });

    const first = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "10.0.0.1" },
    });
    assert.equal(first.status, 200);

    const stillWithinWindow = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "10.0.0.1" },
    });
    assert.equal(stillWithinWindow.status, 429);

    advance(1000);

    const afterRollover = await app.request("/probe", {
      method: "POST",
      headers: { "cf-connecting-ip": "10.0.0.1" },
    });
    assert.equal(afterRollover.status, 200);
  });
});
