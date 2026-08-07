import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { upsertUser, createSession, getSessionUser, deleteSession } from "../server/db.mjs";

describe("GitHub OAuth & Session Auth API", () => {
  test("GET /api/auth/me returns unauthenticated when no session cookie exists", async () => {
    const res = await app.request("/api/auth/me");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.authenticated, false);
    assert.equal(body.user, null);
  });

  test("GET /api/auth/github returns 503 if GITHUB_CLIENT_ID is unconfigured", async () => {
    const res = await app.request("/api/auth/github");
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.ok(body.error.includes("not configured"));
  });

  test("GitHub OAuth start uses PKCE and a configured canonical callback URL", async () => {
    const previous = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      baseUrl: process.env.PUBLIC_BASE_URL,
    };
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    process.env.PUBLIC_BASE_URL = "https://academy.example.test";

    try {
      const res = await app.request("/api/auth/github");
      assert.equal(res.status, 302);
      const location = new URL(res.headers.get("location"));
      assert.equal(location.origin, "https://github.com");
      assert.equal(location.searchParams.get("redirect_uri"), "https://academy.example.test/api/auth/github/callback");
      assert.equal(location.searchParams.get("code_challenge_method"), "S256");
      assert.ok(location.searchParams.get("code_challenge"));
      assert.ok(res.headers.get("set-cookie").includes("mctl_oauth_verifier"));
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[{ clientId: "GITHUB_CLIENT_ID", clientSecret: "GITHUB_CLIENT_SECRET", baseUrl: "PUBLIC_BASE_URL" }[key]];
        else process.env[{ clientId: "GITHUB_CLIENT_ID", clientSecret: "GITHUB_CLIENT_SECRET", baseUrl: "PUBLIC_BASE_URL" }[key]] = value;
      }
    }
  });

  test("DB helper manages user upsert and session lifecycle", async () => {
    const user = await upsertUser({
      githubId: 998877,
      githubLogin: "testuser",
      avatarUrl: "https://github.com/testuser.png",
    });

    assert.ok(user.id);
    assert.equal(user.githubLogin, "testuser");

    const { token } = await createSession(user.id);
    assert.ok(token.startsWith("sess_"));

    const sessionUser = await getSessionUser(token);
    assert.ok(sessionUser);
    assert.equal(sessionUser.githubLogin, "testuser");

    await deleteSession(token);
    const deletedSessionUser = await getSessionUser(token);
    assert.equal(deletedSessionUser, null);
  });

  test("POST /api/auth/logout clears session", async () => {
    const user = await upsertUser({
      githubId: 112233,
      githubLogin: "logoutuser",
      avatarUrl: "https://github.com/logoutuser.png",
    });

    const { token } = await createSession(user.id);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `mctl_session=${token}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    const postLogoutUser = await getSessionUser(token);
    assert.equal(postLogoutUser, null);
  });

  test("POST /api/auth/logout rejects a cross-origin browser request", async () => {
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });

    assert.equal(res.status, 403);
  });
});
