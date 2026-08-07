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
});
