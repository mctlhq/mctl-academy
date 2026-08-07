import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { app } from "../server/app.mjs";
import { authedCookie } from "./helpers/auth-test-helper.mjs";

describe("better-auth session API", () => {
  test("GET /api/auth/get-session returns null when no session cookie exists", async () => {
    const res = await app.request("/api/auth/get-session");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body, null);
  });

  test("GET /api/auth/get-session returns the user for a valid session cookie", async () => {
    const cookie = await authedCookie({ githubLogin: "auth-test-user-1" });

    const res = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.githubLogin, "auth-test-user-1");
  });

  test("GET /api/auth/get-session rejects a tampered session cookie", async () => {
    const cookie = await authedCookie({ githubLogin: "auth-test-user-2" });
    const tampered = cookie.replace("better-auth.session_token=", "better-auth.session_token=tampered-");

    const res = await app.request("/api/auth/get-session", {
      headers: { Cookie: tampered },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body, null);
  });

  test("POST /api/auth/sign-out clears the session", async () => {
    const cookie = await authedCookie({ githubLogin: "auth-test-user-3" });

    const signOutRes = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });
    assert.equal(signOutRes.status, 200);

    const res = await app.request("/api/auth/get-session", {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    assert.equal(body, null);
  });
});
