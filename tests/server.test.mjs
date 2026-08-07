import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";

describe("Hono server & Report API", () => {
  test("GET /healthz returns 200 and status ok", async () => {
    const res = await app.request("/healthz");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "mctl-academy");
  });

  test("POST /api/reports accepts valid report", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    assert.ok(body.report.id.startsWith("rep-"));
  });

  test("POST /api/reports rejects missing question_id", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "invalid_reason_string"
      })
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Invalid or missing reason");
  });
});
