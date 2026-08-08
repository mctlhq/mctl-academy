import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";

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
});
