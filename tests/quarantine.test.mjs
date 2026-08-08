import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quarantineRouter } from "../server/routes/quarantine.mjs";

describe("GET /api/quarantine API", () => {
  test("GET / returns list of quarantined question IDs", async () => {
    const res = await quarantineRouter.request("/");
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.quarantinedQuestionIds));
    assert.equal(typeof body.count, "number");
  });
});
