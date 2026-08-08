import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { securityHeaders, applySecurityHeaders } from "../server/middleware/security-headers.mjs";

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

  test("an unhandled exception still gets the baseline headers on its 500", async () => {
    const { Hono } = await import("hono");
    const probe = new Hono();
    probe.use("*", securityHeaders);
    probe.onError((err, c) => {
      c.status(500);
      applySecurityHeaders(c);
      return c.json({ error: "Internal server error" });
    });
    probe.get("/boom", () => {
      throw new Error("simulated unhandled failure");
    });

    const res = await probe.request("/boom");
    assert.equal(res.status, 500);
    assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
});
