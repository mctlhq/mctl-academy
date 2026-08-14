import { test, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { app } from "../server/app.mjs";
import { authedCookie as createAuthedCookie } from "./helpers/auth-test-helper.mjs";

async function signedInCookie(_githubId, githubLogin) {
  return createAuthedCookie({ githubLogin });
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

  test("GET /readyz reports postgres as ready — DATABASE_URL is required unconditionally since PR4", async () => {
    const res = await app.request("/readyz");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.db, "postgres");
  });

  test("POST /api/reports accepts valid report", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.1" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "typo",
        comment: "Found a minor typo in option A",
      }),
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
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.2" },
      body: JSON.stringify({
        reason: "typo",
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "question_id is required");
  });

  test("POST /api/reports rejects invalid reason", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.3" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "invalid_reason_string",
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Invalid or missing reason");
  });

  test("POST /api/reports rejects unknown question_id with 404", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.4" },
      body: JSON.stringify({
        question_id: "q-doesnotexist9",
        reason: "typo",
      }),
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Unknown question_id");
  });

  test("POST /api/reports rejects comment longer than 2000 characters", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.5" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "typo",
        comment: "x".repeat(2001),
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "comment must be 2000 characters or fewer");
  });

  test("POST /api/reports rejects a cross-origin request", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "typo",
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Cross-origin request rejected.");
  });

  test("POST /api/reports rejects a cross-site request flagged via Sec-Fetch-Site", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.8",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "typo",
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, "Cross-origin request rejected.");
  });

  test("POST /api/reports accepts anonymous callers and never persists a reporter identifier", async () => {
    const res = await app.request("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({
        question_id: "q-df01f3a4b5c6",
        reason: "other",
        comment: "No session, no cookie, still a valid report.",
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(!("reporter_user_id" in body.report));
    assert.ok(!("reporterUserId" in body.report));
  });

  test("POST /api/reports enforces a per-client rate limit and responds 429", async () => {
    const ip = "203.0.113.6";
    let lastStatus;

    for (let i = 0; i < 11; i += 1) {
      const res = await app.request("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({
          question_id: "q-df01f3a4b5c6",
          reason: "typo",
        }),
      });
      lastStatus = res.status;
    }

    assert.equal(lastStatus, 429);
  });

  test("POST /api/reports ignores a spoofed X-Forwarded-For — it cannot buy a fresh rate-limit bucket", async () => {
    // No cf-connecting-ip on any of these: every request lands in the one
    // shared "no trusted IP" bucket regardless of how many distinct,
    // attacker-chosen X-Forwarded-For values it sends.
    let lastStatus;

    for (let i = 0; i < 11; i += 1) {
      const res = await app.request("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `198.51.100.${i}`,
        },
        body: JSON.stringify({
          question_id: "q-df01f3a4b5c6",
          reason: "typo",
        }),
      });
      lastStatus = res.status;
    }

    assert.equal(lastStatus, 429);
  });

  test("a failing insert surfaces as 500, not as a 400 blaming the caller", async () => {
    // The regression this pins (fixed in #168): the handler used to wrap both
    // the body parse and the insert in one try that returned
    // 400 "Invalid JSON payload", so a database outage was reported as the
    // client's malformed request and nothing was logged at all.
    //
    // Failing the insert for real, rather than stubbing insertQuestionReport,
    // is a deliberate choice: mock.module needs
    // --experimental-test-module-mocks, which changes how the whole suite is
    // invoked, and a stub would prove only that a thrown error becomes a 500 --
    // not that this route's actual query can fail that way. The suite already
    // runs against a real Postgres; db-hard-fail.test.mjs makes the same
    // preference explicit for boot-time failures.
    //
    // The failure is induced with a CHECK constraint on one sentinel comment
    // rather than by dropping or renaming the table, and that distinction is
    // load-bearing. `node --test` runs test *files* in parallel processes
    // against this one database, and account.test.mjs writes to
    // question_reports -- so a table that briefly does not exist would fail
    // that file sporadically, from here, for no reason it could diagnose. A
    // constraint that only a string this test invents can violate leaves every
    // concurrent writer working normally.
    // Interpolated rather than parameterised because a CHECK expression cannot
    // take a bind parameter; the value is this literal constant, never input.
    const sentinel = "sentinel: reports-insert-failure-500 regression test";
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const constraint = "tmp_reports_insert_failure_probe";
    const drop = `ALTER TABLE question_reports DROP CONSTRAINT IF EXISTS ${constraint}`;
    try {
      // Dropped first as well as last: the finally below cannot run if the
      // process is killed mid-test (a CI timeout, an OOM), and a constraint
      // left behind would make the next run fail on "already exists" -- an
      // error pointing at the wrong thing entirely. CI gets a fresh database
      // per run, so this only matters on a developer's long-lived one, which
      // is exactly where the confusion would be hardest to place.
      await pool.query(drop);
      await pool.query(
        `ALTER TABLE question_reports
           ADD CONSTRAINT ${constraint} CHECK (comment <> '${sentinel}')`,
      );

      const res = await app.request("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.77" },
        body: JSON.stringify({
          question_id: "q-df01f3a4b5c6",
          reason: "typo",
          comment: sentinel,
        }),
      });

      assert.equal(res.status, 500, "a database failure is the server's fault, not the caller's");
      const body = await res.json();
      assert.equal(body.error, "Internal server error");
    } finally {
      await pool.query(drop);
      await pool.end();
    }
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
      const cookie = await signedInCookie(4242003, "moderator-one-unset-allowlist");
      const res = await app.request("/api/reports", { headers: { Cookie: cookie } });
      assert.equal(res.status, 404);
    });
  });
});

describe("GET /api/admin/stats is admin-only", () => {
  const withStatsAdmins = async (value, run) => {
    const previous = process.env.MCTL_ACADEMY_STATS_ADMINS;
    if (value === undefined) delete process.env.MCTL_ACADEMY_STATS_ADMINS;
    else process.env.MCTL_ACADEMY_STATS_ADMINS = value;
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.MCTL_ACADEMY_STATS_ADMINS;
      else process.env.MCTL_ACADEMY_STATS_ADMINS = previous;
    }
  };

  test("anonymous request is refused and does not disclose the route exists", async () => {
    await withStatsAdmins("admin-one", async () => {
      const res = await app.request("/api/admin/stats");
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.totalSignups, undefined);
    });
  });

  test("signed-in non-admin is refused", async () => {
    await withStatsAdmins("admin-one", async () => {
      const cookie = await signedInCookie(4242004, "ordinary-learner-stats");
      const res = await app.request("/api/admin/stats", { headers: { Cookie: cookie } });
      assert.equal(res.status, 404);
    });
  });

  test("admin on the allowlist may read stats", async () => {
    await withStatsAdmins("Admin-One, someone-else", async () => {
      const cookie = await signedInCookie(4242005, "admin-one");
      const res = await app.request("/api/admin/stats", { headers: { Cookie: cookie } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.totalSignups, "number");
      assert.equal(typeof body.totalSessions, "number");
      assert.equal(typeof body.totalAttempts, "number");
      assert.equal(typeof body.accuracy, "number");
      assert.equal(typeof body.anonymousAttempts, "number");
    });
  });

  test("an unset allowlist fails shut, even for a signed-in user", async () => {
    await withStatsAdmins(undefined, async () => {
      const cookie = await signedInCookie(4242006, "admin-one-unset-allowlist");
      const res = await app.request("/api/admin/stats", { headers: { Cookie: cookie } });
      assert.equal(res.status, 404);
    });
  });
});
