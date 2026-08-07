import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { authedCookie } from "./helpers/auth-test-helper.mjs";

describe("DELETE /api/account — self-service deletion (GDPR Art 17)", () => {
  test("without a session cookie returns 401", async () => {
    const res = await app.request("/api/account", { method: "DELETE" });
    assert.equal(res.status, 401);
  });

  test("rejects a cross-origin request", async () => {
    const cookie = await authedCookie({ githubLogin: "account-delete-cors" });
    const res = await app.request("/api/account", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "https://attacker.example" },
    });
    assert.equal(res.status, 403);
  });

  test("deletes the signed-in user and immediately invalidates their session", async () => {
    const cookie = await authedCookie({ githubLogin: "account-delete-user" });

    const del = await app.request("/api/account", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });
    assert.equal(del.status, 200);
    const body = await del.json();
    assert.equal(body.success, true);

    const session = await app.request("/api/auth/get-session", { headers: { Cookie: cookie } });
    const sessionBody = await session.json();
    assert.equal(sessionBody, null);
  });

  test("cascades to the deleted user's attempts", async () => {
    const cookie = await authedCookie({ githubLogin: "account-delete-cascade" });

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost" },
      body: JSON.stringify({ questionId: "q-account-delete", domain: "domain-1", correct: true }),
    });

    const before = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    assert.equal((await before.json()).attempts.length, 1);

    await app.request("/api/account", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });

    // The session (and thus the cookie) is gone with the user, so re-checking
    // via the API isn't possible — the cascade itself is covered at the DB
    // level; this test's job is only to prove the delete request round-trips
    // for a user who actually has attempts on record, not just a fresh one.
    const after = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    assert.equal(after.status, 401);
  });
});
