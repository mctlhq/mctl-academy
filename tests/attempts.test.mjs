import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { upsertUser, createSession } from "../server/db.mjs";

async function authedCookie(githubId, githubLogin) {
  const user = await upsertUser({
    githubId,
    githubLogin,
    avatarUrl: `https://github.com/${githubLogin}.png`,
  });
  const { token } = await createSession(user.id);
  return `mctl_session=${token}`;
}

describe("Attempt sync API", () => {
  test("POST /api/attempts without a session cookie returns 401 and writes nothing", async () => {
    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: "q-attempts-1", domain: "domain-1", correct: true }),
    });

    assert.equal(res.status, 401);
  });

  test("GET /api/attempts without a session cookie returns 401", async () => {
    const res = await app.request("/api/attempts");
    assert.equal(res.status, 401);
  });

  test("POST then GET /api/attempts round-trips a stored attempt for the authenticated user", async () => {
    const cookie = await authedCookie(50001, "attempts-user-1");

    const postRes = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-attempts-2", domain: "domain-2", correct: true }),
    });

    assert.equal(postRes.status, 201);
    const postBody = await postRes.json();
    assert.equal(postBody.success, true);
    assert.equal(postBody.attempt.questionId, "q-attempts-2");
    assert.equal(postBody.attempt.domain, "domain-2");
    assert.equal(postBody.attempt.correct, true);
    assert.ok(postBody.attempt.attemptedAt);

    const getRes = await app.request("/api/attempts", {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    const found = getBody.attempts.find((a) => a.questionId === "q-attempts-2");
    assert.ok(found);
    assert.equal(found.correct, true);
  });

  test("POST /api/attempts rejects a missing questionId with 400 and does not persist it", async () => {
    const cookie = await authedCookie(50002, "attempts-user-2");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ domain: "domain-1", correct: true }),
    });

    assert.equal(res.status, 400);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    assert.equal(getBody.attempts.length, 0);
  });

  test("POST /api/attempts rejects a non-boolean correct with 400 and does not persist it", async () => {
    const cookie = await authedCookie(50003, "attempts-user-3");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-attempts-3", domain: "domain-1", correct: "yes" }),
    });

    assert.equal(res.status, 400);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    assert.equal(getBody.attempts.find((a) => a.questionId === "q-attempts-3"), undefined);
  });

  test("re-recording an attempt keeps only the latest value per questionId", async () => {
    const cookie = await authedCookie(50004, "attempts-user-4");

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-attempts-4", domain: "domain-3", correct: false }),
    });

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-attempts-4", domain: "domain-3", correct: true }),
    });

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    const matches = getBody.attempts.filter((a) => a.questionId === "q-attempts-4");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].correct, true);
  });
});
