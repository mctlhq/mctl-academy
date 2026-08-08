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
    assert.equal(postBody.attempt.courseId, "agentic-ai-builder");
    assert.ok(postBody.attempt.attemptedAt);

    const getRes = await app.request("/api/attempts", {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    const found = getBody.attempts.find((a) => a.questionId === "q-attempts-2");
    assert.ok(found);
    assert.equal(found.correct, true);
    assert.equal(found.courseId, "agentic-ai-builder");
  });

  test("POST /api/attempts supports multi-course isolation by courseId", async () => {
    const cookie = await authedCookie(50005, "attempts-user-5");

    // Record attempt for course 1: agentic-ai-builder
    const postRes1 = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-mc-1", domain: "domain-1", correct: true, courseId: "agentic-ai-builder" }),
    });
    assert.equal(postRes1.status, 201);

    // Record attempt for course 2: ai-leader
    const postRes2 = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-mc-2", domain: "domain-1", correct: false, courseId: "ai-leader" }),
    });
    assert.equal(postRes2.status, 201);

    // GET attempts for default course: agentic-ai-builder
    const getRes1 = await app.request("/api/attempts?course_id=agentic-ai-builder", {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes1.status, 200);
    const getBody1 = await getRes1.json();
    assert.ok(getBody1.attempts.some((a) => a.questionId === "q-mc-1"));
    assert.equal(getBody1.attempts.some((a) => a.questionId === "q-mc-2"), false);

    // GET attempts for course 2: ai-leader
    const getRes2 = await app.request("/api/attempts?course_id=ai-leader", {
      headers: { Cookie: cookie },
    });
    assert.equal(getRes2.status, 200);
    const getBody2 = await getRes2.json();
    assert.ok(getBody2.attempts.some((a) => a.questionId === "q-mc-2"));
    assert.equal(getBody2.attempts.some((a) => a.questionId === "q-mc-1"), false);
  });

  test("POST /api/attempts rejects an invalid courseId format with 400", async () => {
    const cookie = await authedCookie(50006, "attempts-user-6");

    const res = await app.request("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ questionId: "q-mc-3", domain: "domain-1", correct: true, courseId: "INVALID_COURSE!$" }),
    });

    assert.equal(res.status, 400);
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
