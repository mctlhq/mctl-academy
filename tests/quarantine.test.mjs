import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quarantineRouter, computeQuarantinedQuestionIdsAsync, getQuarantinedQuestionIdsAsync } from "../server/routes/quarantine.mjs";

describe("GET /api/quarantine API & Async Logic", () => {
  test("GET / returns list of quarantined question IDs", async () => {
    const res = await quarantineRouter.request("/");
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.quarantinedQuestionIds));
    assert.equal(typeof body.count, "number");
  });

  test("computeQuarantinedQuestionIdsAsync correctly parses questions and sources asynchronously", async () => {
    const ids = await computeQuarantinedQuestionIdsAsync();
    assert.ok(Array.isArray(ids));
    for (const id of ids) {
      assert.equal(typeof id, "string");
      assert.ok(id.length > 0);
    }
  });

  test("getQuarantinedQuestionIdsAsync caches results across consecutive calls", async () => {
    const first = await getQuarantinedQuestionIdsAsync();
    const second = await getQuarantinedQuestionIdsAsync();
    assert.equal(first, second); // Same cached array instance
  });
});
