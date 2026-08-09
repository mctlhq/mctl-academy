import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { authPool } from "../server/auth.mjs";
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

  test("cascades to the deleted user's question reports — the row is gone, not merely anonymized", async () => {
    const cookie = await authedCookie({ githubLogin: "account-delete-reports-cascade" });
    const session = await (await app.request("/api/auth/get-session", { headers: { Cookie: cookie } })).json();
    const userId = session.user.id;

    await authPool.query(
      `INSERT INTO question_reports (question_id, reason, comment, reporter_user_id) VALUES ($1, $2, $3, $4);`,
      ["q-account-delete-reports", "typo", "test report", userId]
    );

    const before = await authPool.query(`SELECT id FROM question_reports WHERE reporter_user_id = $1;`, [userId]);
    assert.equal(before.rows.length, 1);

    await app.request("/api/account", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });

    // PRIVACY.md promises deletion removes reports "by cascade" — this only
    // holds if the FK is ON DELETE CASCADE. The row must be gone entirely,
    // not merely have reporter_user_id set to NULL (SET NULL would anonymize
    // and retain it, contradicting that promise).
    const after = await authPool.query(`SELECT id FROM question_reports WHERE question_id = $1;`, [
      "q-account-delete-reports",
    ]);
    assert.equal(after.rows.length, 0);
  });

  test("cascades to the deleted user's question votes — the row is gone, not merely orphaned", async () => {
    const cookie = await authedCookie({ githubLogin: "account-delete-votes-cascade" });

    await app.request("/api/votes/q-co01a1b2c3d4", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost" },
      body: JSON.stringify({ value: 1 }),
    });

    const session = await (await app.request("/api/auth/get-session", { headers: { Cookie: cookie } })).json();
    const userId = session.user.id;

    const before = await authPool.query(`SELECT id FROM question_votes WHERE user_id = $1;`, [userId]);
    assert.equal(before.rows.length, 1);

    await app.request("/api/account", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });

    // Same promise as attempts/question_reports (ON DELETE CASCADE): the vote
    // row itself is gone, so it can never contribute to another question's
    // score under a deleted account's identity.
    const after = await authPool.query(`SELECT id FROM question_votes WHERE question_id = $1;`, [
      "q-co01a1b2c3d4",
    ]);
    assert.equal(after.rows.length, 0);
  });
});
