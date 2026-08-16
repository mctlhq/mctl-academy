import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { authedCookie } from "./helpers/auth-test-helper.mjs";

// Real content/questions/*.yaml ids (isKnownQuestionId validates against
// them). Score is a global aggregate across every voter on a question, so
// tests that assert an exact score use a question id no other test in this
// file touches — reusing one across tests would let unrelated votes leak
// into the same aggregate.
const KNOWN_QUESTION_ID = "q-bc01b0c1d2e3";
// Every id below must be a published agentic-ai-builder question that no other
// voting test touches. Two of these used to be `q-co01…`/`q-co02…`, which were
// quarantined CloudOps drafts — deleting that bank took the fixtures with it.
// Draft ids satisfy isKnownQuestionId but are exactly the ids most likely to be
// deleted, so prefer published ones.
const KNOWN_QUESTION_IDS = [
  "q-bc02c1d2e3f4",
  "q-cc01a1b2c3d4",
  "q-cc02b2c3d4e5",
  "q-de06a7b8c9d0",
  "q-de08c9d0e1f2",
];
let nextQuestionIdIndex = 0;
function freshKnownQuestionId() {
  const id = KNOWN_QUESTION_IDS[nextQuestionIdIndex];
  nextQuestionIdIndex += 1;
  if (!id)
    throw new Error("Ran out of distinct known question ids for tests — add more to the fixture list.");
  return id;
}

function putVote(questionId, value, cookie) {
  return app.request(`/api/votes/${questionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ value }),
  });
}

function deleteVote(questionId, cookie) {
  return app.request(`/api/votes/${questionId}`, {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function getVote(questionId, cookie) {
  return app.request(`/api/votes/${questionId}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("Question voting API", () => {
  test("PUT /api/votes/:questionId without a session cookie returns 401", async () => {
    const res = await putVote(KNOWN_QUESTION_ID, 1);
    assert.equal(res.status, 401);
  });

  test("DELETE /api/votes/:questionId without a session cookie returns 401", async () => {
    const res = await deleteVote(KNOWN_QUESTION_ID);
    assert.equal(res.status, 401);
  });

  test("GET /api/votes/:questionId without a session cookie returns 401", async () => {
    const res = await getVote(KNOWN_QUESTION_ID);
    assert.equal(res.status, 401);
  });

  test("PUT /api/votes/:questionId on an unknown question id returns 404", async () => {
    const cookie = await authedCookie({ githubLogin: "votes-user-unknown-question" });
    const res = await putVote("q-does-not-exist", 1, cookie);
    assert.equal(res.status, 404);
  });

  test("PUT /api/votes/:questionId rejects an invalid value with 400 and persists nothing", async () => {
    const cookie = await authedCookie({ githubLogin: "votes-user-invalid-value" });

    for (const badValue of [0, 2, -2, "1", null, undefined]) {
      const res = await putVote(KNOWN_QUESTION_ID, badValue, cookie);
      assert.equal(res.status, 400, `expected 400 for value ${JSON.stringify(badValue)}`);
    }

    const getRes = await getVote(KNOWN_QUESTION_ID, cookie);
    const body = await getRes.json();
    assert.equal(body.userValue, 0);
  });

  test("PUT then GET round-trips an upvote", async () => {
    const cookie = await authedCookie({ githubLogin: "votes-user-upvote" });
    const questionId = freshKnownQuestionId();

    const putRes = await putVote(questionId, 1, cookie);
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.success, true);
    assert.equal(putBody.userValue, 1);
    assert.equal(putBody.score, 1);

    const getRes = await getVote(questionId, cookie);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.userValue, 1);
    assert.equal(getBody.score, 1);
  });

  test("a second PUT with a different value updates the row instead of duplicating it", async () => {
    const cookie = await authedCookie({ githubLogin: "votes-user-change-vote" });
    const questionId = freshKnownQuestionId();

    await putVote(questionId, 1, cookie);
    const secondPut = await putVote(questionId, -1, cookie);
    assert.equal(secondPut.status, 200);
    const secondBody = await secondPut.json();
    assert.equal(secondBody.userValue, -1);
    // This learner's own flip must not leave both a +1 and a -1 counted —
    // net score for a lone voter who changed their mind is their latest value.
    assert.equal(secondBody.score, -1);

    const getRes = await getVote(questionId, cookie);
    const getBody = await getRes.json();
    assert.equal(getBody.userValue, -1);
    assert.equal(getBody.score, -1);
  });

  test("DELETE removes the vote and GET reflects userValue 0", async () => {
    const cookie = await authedCookie({ githubLogin: "votes-user-remove-vote" });
    const questionId = freshKnownQuestionId();

    await putVote(questionId, 1, cookie);
    const deleteRes = await deleteVote(questionId, cookie);
    assert.equal(deleteRes.status, 200);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.success, true);
    assert.equal(deleteBody.userValue, 0);

    const getRes = await getVote(questionId, cookie);
    const getBody = await getRes.json();
    assert.equal(getBody.userValue, 0);
  });

  test("DELETE on a question the learner never voted on is a no-op, not an error", async () => {
    const cookie = await authedCookie({ githubLogin: "votes-user-delete-noop" });
    const res = await deleteVote(KNOWN_QUESTION_ID, cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.userValue, 0);
  });

  test("two learners voting oppositely on the same question net to the correct score", async () => {
    const cookieA = await authedCookie({ githubLogin: "votes-user-net-a" });
    const cookieB = await authedCookie({ githubLogin: "votes-user-net-b" });
    const questionId = freshKnownQuestionId();

    const putA = await putVote(questionId, 1, cookieA);
    assert.equal((await putA.json()).score, 1);

    const putB = await putVote(questionId, -1, cookieB);
    const bodyB = await putB.json();
    assert.equal(bodyB.userValue, -1);
    assert.equal(bodyB.score, 0);

    const getA = await getVote(questionId, cookieA);
    const bodyGetA = await getA.json();
    assert.equal(bodyGetA.userValue, 1);
    assert.equal(bodyGetA.score, 0);
  });

  test("a concurrent double PUT with the same value from the same user is idempotent", async () => {
    const cookie = await authedCookie({ githubLogin: "votes-user-concurrent" });
    const questionId = freshKnownQuestionId();

    const [resA, resB] = await Promise.all([putVote(questionId, 1, cookie), putVote(questionId, 1, cookie)]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const getRes = await getVote(questionId, cookie);
    const body = await getRes.json();
    assert.equal(body.userValue, 1);
    // Not 2 — the UNIQUE (user_id, question_id) constraint plus the upsert
    // means a repeated identical vote can never be double-counted.
    assert.equal(body.score, 1);
  });
});
