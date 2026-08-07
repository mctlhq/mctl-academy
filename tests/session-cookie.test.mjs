import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cookieName, cookieOptions, sessionCookieName } from "../server/session-cookie.mjs";

/**
 * Regression cover for a production-only defect: auth.mjs wrote the session as
 * `__Host-mctl_session` under NODE_ENV=production while attempts.mjs read the
 * literal `mctl_session`, so every attempt sync 401'd for signed-in learners.
 * The normal suite cannot see it because tests do not run as production.
 */
describe("session cookie naming", () => {
  const asProduction = (run) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      run();
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  };

  test("production uses the __Host- prefix", () => {
    asProduction(() => {
      assert.equal(sessionCookieName(), "__Host-mctl_session");
      assert.equal(cookieName("mctl_oauth_state"), "__Host-mctl_oauth_state");
    });
  });

  test("outside production the prefix is dropped so local HTTP works", () => {
    assert.equal(sessionCookieName(), "mctl_session");
  });

  test("production cookie options satisfy the __Host- prefix requirements", () => {
    asProduction(() => {
      const options = cookieOptions(60);
      assert.equal(options.secure, true, "__Host- requires Secure");
      assert.equal(options.path, "/", "__Host- requires path=/");
      assert.equal(options.domain, undefined, "__Host- forbids a Domain attribute");
      assert.equal(options.httpOnly, true);
    });
  });

  test("no route hardcodes the session cookie name", () => {
    for (const file of [
      "server/routes/auth.mjs",
      "server/routes/attempts.mjs",
      "server/app.mjs",
    ]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const hardcoded = /getCookie\(\s*c\s*,\s*["'`]mctl_session["'`]\s*\)/.test(source);
      assert.equal(
        hardcoded,
        false,
        `${file} reads a hardcoded "mctl_session"; use sessionCookieName() so production and the routes agree`
      );
    }
  });
});
