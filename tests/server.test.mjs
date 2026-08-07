import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";

describe("Hono server & Report API", () => {
  test("GET /healthz returns 200, status ok, and runtime identifier", async () => {
    const res = await app.request("/healthz");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "mctl-academy");
    assert.ok(body.runtime === "node" || body.runtime === "bun");
  });

  test("POST /api/reports accepts valid report", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.1" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "typo",
        comment: "Found a minor typo in option A"
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.report.question_id, "q-df01f3a4b5c6");
    assert.equal(body.report.reason, "typo");
    assert.ok(body.report.id);
  });

  test("POST /api/reports rejects missing question_id", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.2" },
      body: JSON.stringify({
        reason: "typo"
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "question_id is required");
  });

  test("POST /api/reports rejects invalid reason", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.3" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "invalid_reason_string"
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Invalid or missing reason");
  });

  test("POST /api/reports rejects unknown question_id with 404", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.4" },
      body: JSON.stringify({
        question_id: "q-doesnotexist9",
        reason: "typo"
      })
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Unknown question_id");
  });

  test("POST /api/reports rejects comment longer than 2000 characters", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.5" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "typo",
        comment: "x".repeat(2001)
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "comment must be 2000 characters or fewer");
  });

  test("POST /api/reports enforces a per-client rate limit and responds 429", async () => {
    const ip = "203.0.113.6";
    let lastStatus;

    for (let i = 0; i < 11; i += 1) {
      const res = await app.request("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({
          question_id: "q-df01f3a4b5c6",
          reason: "typo"
        })
      });
      lastStatus = res.status;
    }

    assert.equal(lastStatus, 429);
  });
});
