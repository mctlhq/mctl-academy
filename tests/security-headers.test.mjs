import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HTTPException } from "hono/http-exception";
import { app, errorHandler } from "../server/app.mjs";
import { securityHeaders } from "../server/middleware/security-headers.mjs";

describe("Security header baseline (PLAN.md Track A, PR2b)", () => {
  test("API responses carry the baseline headers", async () => {
    const res = await app.request("/healthz");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
    assert.ok(!res.headers.get("content-security-policy").includes("script-src 'self' 'unsafe-inline'"));
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.ok(res.headers.get("permissions-policy"));
  });

  test("clickjacking is refused by both controls at once, and they agree", async () => {
    // X-Frame-Options is the legacy compatibility half of the same decision
    // the CSP's frame-ancestors makes. Asserted together so a future change
    // cannot relax one while leaving the other looking protective — e.g.
    // loosening frame-ancestors to 'self' and forgetting XFO still says DENY.
    const res = await app.request("/healthz");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  });

  test("the error paths carry X-Frame-Options too, not just the success path", async () => {
    // The 500 and HTTPException paths build their headers through the same
    // shared list; this pins that the new header travels with them rather
    // than only on responses that went through the middleware's happy path.
    const { Hono } = await import("hono");
    const probe = new Hono();
    probe.onError(errorHandler);
    probe.get("/boom", () => {
      throw new Error("simulated unhandled failure");
    });

    const res = await probe.request("/boom");
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  });

  test("static SPA fallback also carries the baseline headers", async () => {
    const res = await app.request("/");
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
  });

  test("HSTS is sent only when NODE_ENV=production", async () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      let res = await app.request("/healthz");
      assert.equal(res.headers.get("strict-transport-security"), null);

      process.env.NODE_ENV = "production";
      res = await app.request("/healthz");
      assert.match(res.headers.get("strict-transport-security"), /max-age=63072000/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  test("no wildcard CORS header is ever sent", async () => {
    const res = await app.request("/healthz", { headers: { Origin: "https://evil.example" } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  test("a real better-auth OAuth redirect response still carries the baseline headers", async () => {
    // Regression test for a reviewer false positive: better-auth's redirects
    // (server/auth.mjs's /api/auth/*) are built via better-call's toResponse,
    // which uses `new Response()`, not the static `Response.redirect()` —
    // only the latter has an immutable Fetch-spec header guard. This exact
    // callback path (no `code` param) exercises that real redirect, not a
    // synthetic one, to prove c.header() after next() doesn't throw on it.
    const res = await app.request("/api/auth/callback/github", { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
  });

  // Both tests below register app.mjs's own exported errorHandler on a
  // throwaway probe, rather than a hand-duplicated copy — if a future edit
  // drops applySecurityHeaders()/applySecurityHeadersToResponse() from the
  // real handler, these tests fail too, since it's the exact same function.
  test("an unhandled exception still gets the baseline headers on its 500", async () => {
    const { Hono } = await import("hono");
    const probe = new Hono();
    probe.use("*", securityHeaders);
    probe.onError(errorHandler);
    probe.get("/boom", () => {
      throw new Error("simulated unhandled failure");
    });

    const res = await probe.request("/boom");
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  test("an HTTPException keeps its own status/response instead of being flattened to 500, and still gets the baseline headers", async () => {
    const { Hono } = await import("hono");
    const probe = new Hono();
    probe.use("*", securityHeaders);
    probe.onError(errorHandler);
    probe.get("/rate-limited", () => {
      throw new HTTPException(429, { message: "Too many requests" });
    });

    const res = await probe.request("/rate-limited");
    assert.equal(res.status, 429);
    assert.equal(await res.text(), "Too many requests");
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
});
