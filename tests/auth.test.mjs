import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { auth } from "../server/auth.mjs";
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
