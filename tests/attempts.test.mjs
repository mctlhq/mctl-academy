import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { authedCookie as createAuthedCookie } from "./helpers/auth-test-helper.mjs";
import { gradableQuestion } from "./helpers/answer-key-fixture.mjs";

// Attempts are graded against the real answer key in content/ (issue #208).
// Each learner below has their own attempt history, so the same questions can
// be reused across tests without one test's rows leaking into another's.
const Q1 = gradableQuestion(0);
const Q2 = gradableQuestion(1);
const right = (q) => ({ questionId: q.id, optionId: q.correctOptionId });
const wrong = (q) => ({ questionId: q.id, optionId: q.wrongOptionId });

async function authedCookie(_githubId, githubLogin) {
  return createAuthedCookie({ githubLogin });
}

describe("Attempt sync API", () => {
  test("POST /api/attempts without a session cookie returns 401 and writes nothing", async () => {
    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(right(Q1)),
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
      body: JSON.stringify(right(Q1)),
    });

    assert.equal(postRes.status, 201);
    const postBody = await postRes.json();
    assert.equal(postBody.success, true);
    assert.equal(postBody.attempt.questionId, Q1.id);
    assert.equal(postBody.attempt.domain, Q1.domain);
    assert.equal(postBody.attempt.correct, true);
    assert.ok(postBody.attempt.attemptedAt);

    const getRes = await app.request("/api/attempts", {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    const found = getBody.attempts.find((a) => a.questionId === Q1.id);
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
      body: JSON.stringify(right(Q1)),
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
    const found = getBody.attempts.find((a) => a.questionId === Q1.id);
    assert.ok(found);
    assert.deepEqual(Object.keys(found).sort(), ["attemptedAt", "correct", "domain", "questionId"]);
  });

  test("a courseId sent by a stale client is ignored, never stored or echoed back", async () => {
    const cookie = await authedCookie(50006, "attempts-user-6");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...right(Q1), courseId: "ai-leader" }),
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
      body: JSON.stringify({ optionId: Q1.correctOptionId }),
    });

    assert.equal(res.status, 400);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    assert.equal(getBody.attempts.length, 0);
  });

  test("POST /api/attempts rejects a missing or non-string optionId with 400 and does not persist it", async () => {
    const cookie = await authedCookie(50003, "attempts-user-3");

    for (const body of [
      { questionId: Q1.id },
      { questionId: Q1.id, optionId: 1 },
      // The pre-#208 payload: a boolean the server used to trust.
      { questionId: Q1.id, domain: Q1.domain, correct: true },
    ]) {
      const res = await app.request("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, JSON.stringify(body));
    }

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    assert.equal(getBody.attempts.length, 0);
  });

  test("a forged correct=true with a wrong option is stored as incorrect (issue #208)", async () => {
    const cookie = await authedCookie(50010, "attempts-user-10");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...wrong(Q1), correct: true, domain: "forged-domain" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.attempt.correct, false);
    assert.equal(body.attempt.domain, Q1.domain);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const found = (await getRes.json()).attempts.find((a) => a.questionId === Q1.id);
    assert.ok(found);
    assert.equal(found.correct, false);
    assert.equal(found.domain, Q1.domain);
  });

  test("the correct option is stored as correct even when the client claims correct=false", async () => {
    const cookie = await authedCookie(50011, "attempts-user-11");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ ...right(Q1), correct: false }),
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).attempt.correct, true);
  });

  test("optionId null (a Mock exam question left unanswered) is stored as incorrect", async () => {
    const cookie = await authedCookie(50012, "attempts-user-12");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: Q1.id, optionId: null, correct: true }),
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).attempt.correct, false);
  });

  test("an unknown questionId or optionId is rejected with 400 and not persisted", async () => {
    const cookie = await authedCookie(50013, "attempts-user-13");

    for (const body of [
      { questionId: "q-does-not-exist", optionId: "a" },
      { questionId: Q1.id, optionId: "z" },
      // A rendered position is not an option id.
      { questionId: Q1.id, optionId: "0" },
    ]) {
      const res = await app.request("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, JSON.stringify(body));
    }

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    assert.equal((await getRes.json()).attempts.length, 0);
  });

  test("re-recording an attempt keeps only the latest value per questionId", async () => {
    const cookie = await authedCookie(50004, "attempts-user-4");

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(wrong(Q1)),
    });

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(right(Q1)),
    });

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    const matches = getBody.attempts.filter((a) => a.questionId === Q1.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].correct, true);
  });

  test("DELETE /api/attempts without a session cookie returns 401 and deletes nothing", async () => {
    const cookie = await authedCookie(50106, "attempts-user-106");
    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(right(Q1)),
    });

    const deleteRes = await app.request("/api/attempts", { method: "DELETE" });
    assert.equal(deleteRes.status, 401);

    const getRes = await app.request("/api/attempts", { headers: { Cookie: cookie } });
    const getBody = await getRes.json();
    assert.ok(getBody.attempts.find((a) => a.questionId === Q1.id));
  });

  test("DELETE /api/attempts erases every attempt for the authenticated user — Clear history", async () => {
    const cookie = await authedCookie(50107, "attempts-user-107");

    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(right(Q1)),
    });
    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(wrong(Q2)),
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
      body: JSON.stringify(right(Q1)),
    });
    await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify(right(Q2)),
    });

    await app.request("/api/attempts", { method: "DELETE", headers: { Cookie: cookieA } });

    const getResA = await app.request("/api/attempts", { headers: { Cookie: cookieA } });
    assert.equal((await getResA.json()).attempts.length, 0);

    const getResB = await app.request("/api/attempts", { headers: { Cookie: cookieB } });
    const bodyB = await getResB.json();
    assert.ok(bodyB.attempts.find((a) => a.questionId === Q2.id));
  });
});
