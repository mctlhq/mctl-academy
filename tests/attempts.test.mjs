import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { authedCookie as createAuthedCookie } from "./helpers/auth-test-helper.mjs";

async function authedCookie(_githubId, githubLogin) {
  return createAuthedCookie({ githubLogin });
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

  test("an attempt is stored and returned with no course association", async () => {
    // Course membership is content metadata (questionId -> question.course_id),
    // not learner telemetry. Nothing about a learner's chosen course may be
    // transmitted to or persisted by the server, so both the write path and the
    // read path must be free of it — the client scopes progress per course by
    // intersecting these attempts with the active course's question ids.
    const cookie = await authedCookie(50005, "attempts-user-5");

    const postRes = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-privacy-1", domain: "domain-1", correct: true }),
    });
    assert.equal(postRes.status, 201);

    const postBody = await postRes.json();
    assert.deepEqual(Object.keys(postBody.attempt).sort(), [
      "attemptedAt",
      "correct",
      "domain",
      "questionId",
    ]);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    const found = getBody.attempts.find((a) => a.questionId === "q-privacy-1");
    assert.ok(found);
    assert.deepEqual(Object.keys(found).sort(), ["attemptedAt", "correct", "domain", "questionId"]);
  });

  test("a courseId sent by a stale client is ignored, never stored or echoed back", async () => {
    const cookie = await authedCookie(50006, "attempts-user-6");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        questionId: "q-privacy-2",
        domain: "domain-1",
        correct: true,
        courseId: "ai-leader",
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.attempt.courseId, undefined);
    assert.ok(!JSON.stringify(body).includes("ai-leader"));
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
    assert.equal(
      getBody.attempts.find((a) => a.questionId === "q-attempts-3"),
      undefined,
    );
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

  test("DELETE /api/attempts without a session cookie returns 401 and deletes nothing", async () => {
    const cookie = await authedCookie(50106, "attempts-user-106");
    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-attempts-106", domain: "domain-1", correct: true }),
    });

    const deleteRes = await app.request("/api/attempts", { method: "DELETE" });
    assert.equal(deleteRes.status, 401);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    assert.ok(getBody.attempts.find((a) => a.questionId === "q-attempts-106"));
  });

  test("DELETE /api/attempts erases every attempt for the authenticated user — Clear history", async () => {
    const cookie = await authedCookie(50107, "attempts-user-107");

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-attempts-107a", domain: "domain-1", correct: true }),
    });
    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-attempts-107b", domain: "domain-2", correct: false }),
    });

    const deleteRes = await app.request("/api/attempts", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    assert.equal(deleteRes.status, 200);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.success, true);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    assert.equal(getBody.attempts.length, 0);
  });

  test("DELETE /api/attempts does not touch another learner's attempts", async () => {
    const cookieA = await authedCookie(50108, "attempts-user-108");
    const cookieB = await authedCookie(50109, "attempts-user-109");

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({ questionId: "q-attempts-108", domain: "domain-1", correct: true }),
    });
    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({ questionId: "q-attempts-109", domain: "domain-1", correct: true }),
    });

    await app.request("/api/attempts", { method: "DELETE", headers: { Cookie: cookieA } });

    const getResA = await app.request("/api/attempts", { headers: { Cookie: cookieA } });
    assert.equal((await getResA.json()).attempts.length, 0);

    const getResB = await app.request("/api/attempts", { headers: { Cookie: cookieB } });
    const bodyB = await getResB.json();
    assert.ok(bodyB.attempts.find((a) => a.questionId === "q-attempts-109"));
  });
});
