import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { upsertUser, createSession } from "../server/db.mjs";
import { sessionCookieName } from "../server/session-cookie.mjs";

async function signedInCookie(githubId, githubLogin) {
  const user = await upsertUser({
    githubId,
    githubLogin,
    avatarUrl: `https://github.com/${githubLogin}.png`,
  });
  const { token } = await createSession(user.id);
  return `${sessionCookieName()}=${token}`;
}

describe("Hono server & Report API", () => {
  test("GET /healthz returns 200, status ok, and runtime identifier", async () => {
    const res = await app.request("/healthz");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "mctl-academy");
    assert.ok(body.runtime === "node" || body.runtime === "bun");
  });

  test("GET /livez matches /healthz and carries no dependency check", async () => {
    const res = await app.request("/livez");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.service, "mctl-academy");
  });

  test("GET /readyz reports the memory store as ready outside production", async () => {
    const res = await app.request("/readyz");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.db, "memory");
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

describe("GET /api/reports is moderator-only", () => {
  const withModerators = async (value, run) => {
    const previous = process.env.MCTL_ACADEMY_MODERATORS;
    if (value === undefined) delete process.env.MCTL_ACADEMY_MODERATORS;
    else process.env.MCTL_ACADEMY_MODERATORS = value;
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.MCTL_ACADEMY_MODERATORS;
      else process.env.MCTL_ACADEMY_MODERATORS = previous;
    }
  };

  test("anonymous request is refused and does not disclose the route exists", async () => {
    await withModerators("moderator-one", async () => {
      const res = await app.request("/api/reports");
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.reports, undefined);
    });
  });

  test("signed-in non-moderator is refused", async () => {
    await withModerators("moderator-one", async () => {
      const cookie = await signedInCookie(4242001, "ordinary-learner");
      const res = await app.request("/api/reports", { headers: { Cookie: cookie } });
      assert.equal(res.status, 404);
    });
  });

  test("moderator on the allowlist may read reports", async () => {
    await withModerators("Moderator-One, someone-else", async () => {
      const cookie = await signedInCookie(4242002, "moderator-one");
      const res = await app.request("/api/reports", { headers: { Cookie: cookie } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.reports));
    });
  });

  test("an unset allowlist fails shut, even for a signed-in user", async () => {
    await withModerators(undefined, async () => {
      const cookie = await signedInCookie(4242003, "moderator-one");
      const res = await app.request("/api/reports", { headers: { Cookie: cookie } });
      assert.equal(res.status, 404);
    });
  });
});
