import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "../server/app.mjs";
import { auth, authPool, backfillGithubLogin, stashGithubProfileLogin } from "../server/auth.mjs";
import { authedCookie } from "./helpers/auth-test-helper.mjs";

describe("better-auth session API", () => {
  test("GET /api/auth/get-session returns null when no session cookie exists", async () => {
    const res = await app.request("/api/auth/get-session");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body, null);
  });

  test("GET /api/auth/get-session returns the user for a valid session cookie", async () => {
    const cookie = await authedCookie({ githubLogin: "auth-test-user-1" });

    const res = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.githubLogin, "auth-test-user-1");
  });

  test("GET /api/auth/get-session rejects a tampered session cookie", async () => {
    const cookie = await authedCookie({ githubLogin: "auth-test-user-2" });
    const tampered = cookie.replace("better-auth.session_token=", "better-auth.session_token=tampered-");

    const res = await app.request("/api/auth/get-session", {
      headers: { Cookie: tampered },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body, null);
  });

  test("POST /api/auth/sign-out clears the session", async () => {
    const cookie = await authedCookie({ githubLogin: "auth-test-user-3" });

    const signOutRes = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });
    assert.equal(signOutRes.status, 200);

    const res = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    assert.equal(body, null);
  });
});

describe("session ipAddress/userAgent scrub (PRIVACY.md)", () => {
  test("databaseHooks.session.create.before nulls ipAddress and userAgent regardless of input", async () => {
    // Exercises the hook directly rather than through a real sign-in: the
    // only session-creation path this suite's authedCookie() helper uses
    // inserts straight into the "session" table via raw SQL, bypassing
    // better-auth's internal adapter — and with it, this hook — entirely.
    // Without this test, a subtly wrong hook shape (wrong return key, a
    // dropped field) would leave real IP/UA writes silently in place on
    // every actual sign-in while CI stayed green.
    const hook = auth.options.databaseHooks.session.create.before;
    assert.equal(typeof hook, "function");

    const result = await hook({
      id: "session-scrub-test",
      userId: "user-scrub-test",
      token: "token-scrub-test",
      ipAddress: "203.0.113.99",
      userAgent: "Mozilla/5.0 (test)",
      expiresAt: new Date(),
    });

    assert.equal(result.data.ipAddress, null);
    assert.equal(result.data.userAgent, null);
    // Everything else must pass through unmodified — this is a scrub, not a
    // filter that happens to also drop unrelated session fields.
    assert.equal(result.data.id, "session-scrub-test");
    assert.equal(result.data.userId, "user-scrub-test");
    assert.equal(result.data.token, "token-scrub-test");
  });
});

describe("githubLogin backfill (session.create.after)", () => {
  // githubLogin is declared `input: false` on the user schema so the public
  // update-user endpoint can never be used to self-elevate into the
  // moderator/admin-stats allowlists — but that same flag also silently
  // drops better-auth's own OAuth-profile mapping before it reaches the DB.
  // backfillGithubLogin bypasses the field filter with a raw query instead.
  // See the long comment above it in server/auth.mjs for the full story.
  //
  // authedCookie() inserts its session row directly via raw SQL too, so it
  // never runs this hook — these tests call it explicitly, seeded via the
  // same account+session tables a real GitHub sign-in would populate.
  async function insertUserAndGithubAccount({ githubAccountId }) {
    const userId = randomUUID();
    const now = new Date();
    await authPool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, $4, $4);`,
      [userId, "backfill-test", `${userId}@users.noreply.github.com`, now]
    );
    await authPool.query(
      `INSERT INTO "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'github', $3, $4, $4);`,
      [randomUUID(), githubAccountId, userId, now]
    );
    return userId;
  }

  test("writes the stashed GitHub login onto the user row", async () => {
    const githubAccountId = `gh-${randomUUID()}`;
    const userId = await insertUserAndGithubAccount({ githubAccountId });
    stashGithubProfileLogin(githubAccountId, "octocat");

    await backfillGithubLogin({ userId });

    const { rows } = await authPool.query(`SELECT "githubLogin" FROM "user" WHERE id = $1`, [userId]);
    assert.equal(rows[0].githubLogin, "octocat");
  });

  test("is a no-op when nothing was stashed for this account (e.g. a Google sign-in)", async () => {
    const githubAccountId = `gh-${randomUUID()}`;
    const userId = await insertUserAndGithubAccount({ githubAccountId });

    await backfillGithubLogin({ userId });

    const { rows } = await authPool.query(`SELECT "githubLogin" FROM "user" WHERE id = $1`, [userId]);
    assert.equal(rows[0].githubLogin, null);
  });

  test("is a no-op when the session's user has no linked GitHub account at all", async () => {
    // Never throws — a broken lookup here must not turn into a failed
    // sign-in for the user it's trying to help.
    await assert.doesNotReject(backfillGithubLogin({ userId: randomUUID() }));
  });
});
