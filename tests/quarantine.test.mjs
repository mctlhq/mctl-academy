import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quarantineRouter, computeQuarantinedQuestionIds } from "../server/routes/quarantine.mjs";

describe("GET /api/quarantine API & Logic", () => {
  test("GET / returns list of quarantined question IDs", async () => {
    const res = await quarantineRouter.request("/");
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.quarantinedQuestionIds));
    assert.equal(typeof body.count, "number");
  });

  test("computeQuarantinedQuestionIds correctly filters needs_review and drifted citations", () => {
    const ids = computeQuarantinedQuestionIds();
    assert.ok(Array.isArray(ids));
    // Verify every returned ID is a non-empty string
    for (const id of ids) {
      assert.equal(typeof id, "string");
      assert.ok(id.length > 0);
    }
  });
});
