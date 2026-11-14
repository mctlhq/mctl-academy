import "./helpers/client-dist-fixture.mjs";
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { apiErrorLog } from "../server/middleware/request-log.mjs";

/** A probe app with the middleware and handlers that answer the given way. */
function probe() {
  const lines = [];
  const app = new Hono();
  app.onError((_err, c) => c.json({ error: "Internal server error" }, 500));
  app.use("/api/*", apiErrorLog({ write: (line) => lines.push(JSON.parse(line)) }));
  app.get("/api/ok", (c) => c.json({ ok: true }));
  app.post("/api/attempts", (c) => c.json({ error: "unknown_question" }, 400));
  app.get("/api/free-text", (c) => c.json({ error: "Somebody typed alice@example.com here" }, 400));
  app.get("/api/auth/callback/github", (c) => c.json({ code: "STATE_MISMATCH" }, 403));
  app.get("/api/throws", () => {
    throw new Error("boom");
  });
  app.get("/api/plain", (c) => c.text("nope", 429));
  return { app, lines };
}

describe("apiErrorLog", () => {
  test("logs nothing for a 2xx", async () => {
    const { app, lines } = probe();
    assert.equal((await app.request("/api/ok")).status, 200);
    assert.deepEqual(lines, []);
  });

  test("logs a 4xx with method, path, status, duration and the error code", async () => {
    const { app, lines } = probe();
    const res = await app.request("/api/attempts", { method: "POST", body: "{}" });
    assert.equal(res.status, 400);
    // The response itself still reaches the client intact.
    assert.deepEqual(await res.json(), { error: "unknown_question" });
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.equal(line.level, "warn");
    assert.equal(line.msg, "api_response");
    assert.equal(line.method, "POST");
    assert.equal(line.path, "/api/attempts");
    assert.equal(line.status, 400);
    assert.equal(line.code, "unknown_question");
    assert.equal(typeof line.ms, "number");
  });

  test("never logs the query string (OAuth code and state live there)", async () => {
    const { app, lines } = probe();
    await app.request("/api/auth/callback/github?code=secret-code&state=secret-state");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].path, "/api/auth/callback/github");
    assert.equal(lines[0].code, "STATE_MISMATCH");
    assert.doesNotMatch(JSON.stringify(lines[0]), /secret-code|secret-state/);
  });

  test("drops free-text error messages instead of echoing them", async () => {
    const { app, lines } = probe();
    await app.request("/api/free-text");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].code, undefined);
    assert.doesNotMatch(JSON.stringify(lines[0]), /alice/);
  });

  test("logs a thrown handler's 500 at error level", async () => {
    const { app, lines } = probe();
    assert.equal((await app.request("/api/throws")).status, 500);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "error");
    assert.equal(lines[0].status, 500);
  });

  test("logs a non-JSON failure without a code", async () => {
    const { app, lines } = probe();
    assert.equal((await app.request("/api/plain")).status, 429);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].code, undefined);
  });
});

describe("apiErrorLog is wired into the real app", () => {
  const realLog = console.log;
  afterEach(() => {
    console.log = realLog;
  });

  test("an unauthenticated POST /api/attempts leaves one api_response line", async () => {
    const { app } = await import("../server/app.mjs");
    const captured = [];
    console.log = (...args) => captured.push(args.join(" "));
    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ questionId: "q-x", optionId: "a" }),
    });
    console.log = realLog;
    assert.ok(res.status >= 400, `expected a failure, got ${res.status}`);
    const lines = captured.filter((l) => l.includes('"api_response"')).map((l) => JSON.parse(l));
    assert.equal(lines.length, 1, captured.join("\n"));
    assert.equal(lines[0].path, "/api/attempts");
    assert.equal(lines[0].status, res.status);
  });

  test("a non-API path is never logged", async () => {
    const { app } = await import("../server/app.mjs");
    const captured = [];
    console.log = (...args) => captured.push(args.join(" "));
    await app.request("/definitely-not-a-page-404");
    console.log = realLog;
    assert.equal(captured.filter((l) => l.includes('"api_response"')).length, 0);
  });
});
