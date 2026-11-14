import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FakeZitadel } from "./helpers/fake-zitadel.mjs";

/**
 * The whole ZITADEL sign-in through the real better-auth handler and a real
 * Postgres: sign-in → (fake) issuer → callback → session. Only the issuer's
 * network endpoints are faked. node --test runs every file in its own
 * process, so configuring ZITADEL here, before the app is imported, does not
 * leak into the other suites.
 */
const issuer = new FakeZitadel();
process.env.ZITADEL_ISSUER = issuer.issuer;
process.env.ZITADEL_CLIENT_ID = issuer.clientId;
process.env.ZITADEL_CLIENT_SECRET = issuer.clientSecret;
process.env.ZITADEL_DISPLAY_NAME = "MCTL account";
// The redirect URI is built from it; app.request() serves http://localhost.
process.env.BETTER_AUTH_URL = "http://localhost";

/** What zitadel-iac registers for academy, on this test's origin. */
const REGISTERED_REDIRECT_URI = "http://localhost/api/auth/oauth2/callback/zitadel";

const realFetch = globalThis.fetch;
globalThis.fetch = /** @type {typeof fetch} */ (
  async (input, init) => (await issuer.fetch(input, init)) ?? realFetch(input, init)
);

const { app } = await import("../server/app.mjs");
const { authPool } = await import("../server/auth.mjs");

after(() => {
  globalThis.fetch = realFetch;
});

function cookiesOf(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Sign in with ZITADEL as `login`; returns the callback response. */
async function signIn(login) {
  const start = await app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ provider: "zitadel", callbackURL: "/" }),
  });
  assert.equal(start.status, 200, await start.clone().text());
  const { url } = await start.json();
  const authorize = new URL(url);
  assert.equal(authorize.origin + authorize.pathname, `${issuer.issuer}/oauth/v2/authorize`);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  // The redirect URI ZITADEL has registered, not better-auth 1.7's default
  // /api/auth/callback/zitadel; the fake's token endpoint checks the
  // exchange repeats it.
  assert.equal(authorize.searchParams.get("redirect_uri"), REGISTERED_REDIRECT_URI);
  assert.equal(authorize.searchParams.get("client_id"), issuer.clientId);
  assert.equal(authorize.searchParams.get("response_type"), "code");
  assert.deepEqual(authorize.searchParams.get("scope")?.split(" ").sort(), ["email", "openid", "profile"]);

  const code = randomUUID();
  issuer.approve(code, url, login);
  return app.request(
    `/api/auth/oauth2/callback/zitadel?${new URLSearchParams({ code, state: authorize.searchParams.get("state") })}`,
    { headers: { cookie: cookiesOf(start) } },
  );
}

async function accountsFor(email) {
  const { rows } = await authPool.query(
    `SELECT a."providerId", a."accountId", u."githubLogin" FROM "user" u JOIN "account" a ON a."userId" = u.id WHERE u.email = $1 ORDER BY a."providerId"`,
    [email],
  );
  return rows;
}

describe("ZITADEL sign-in, end to end", () => {
  const sub = `29${Date.now()}`;
  const email = `zitadel-${sub}@example.com`;
  let sessionCookie = "";

  before(async () => {
    const response = await signIn({ sub, email, name: "Zed" });
    assert.equal(response.status, 302, await response.clone().text());
    assert.equal(response.headers.get("location"), "/");
    sessionCookie = cookiesOf(response);
    assert.match(sessionCookie, /better-auth\.session_token=/);
  });

  test("forwards a form_post (POST) callback on the registered path instead of failing", async () => {
    // ZITADEL may return the callback with response_mode=form_post. The
    // forwarded copy (handleAuthRequest) must carry the method and the body;
    // passing the Request itself as the init does that on Node and Bun, no
    // duplex option needed. The state is unknown, so better-auth refuses the
    // sign-in itself; what matters is that the request reached it.
    const response = await app.request("/api/auth/oauth2/callback/zitadel", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: randomUUID(), state: "unknown-state" }).toString(),
    });
    assert.notEqual(response.status, 500, await response.clone().text());
    assert.notEqual(response.status, 404);
  });

  test("advertises the button only because the server has ZITADEL configured", async () => {
    const response = await app.request("/api/sign-in-options");
    assert.deepEqual(await response.json(), { zitadel: { providerId: "zitadel", label: "MCTL account" } });
  });

  test("creates a user keyed by the ZITADEL sub, with no githubLogin", async () => {
    assert.deepEqual(await accountsFor(email), [
      { providerId: "zitadel", accountId: sub, githubLogin: null },
    ]);
    const session = await app.request("/api/auth/get-session", { headers: { cookie: sessionCookie } });
    assert.equal((await session.json()).user.email, email);
  });

  test("signs the same person in again to the same user", async () => {
    const again = await signIn({ sub, email, name: "Zed" });
    assert.equal(again.status, 302);
    assert.equal(again.headers.get("location"), "/");
    assert.equal((await accountsFor(email)).length, 1);
  });

  test("a stats-admin allowlist names a ZITADEL user only as zitadel:<sub>", async () => {
    const previous = process.env.MCTL_ACADEMY_STATS_ADMINS;
    try {
      // Name and e-mail are chosen at self-registration; neither lists anyone.
      process.env.MCTL_ACADEMY_STATS_ADMINS = `Zed,${email}`;
      const byName = await app.request("/api/admin/stats", { headers: { cookie: sessionCookie } });
      assert.equal(byName.status, 404);

      process.env.MCTL_ACADEMY_STATS_ADMINS = `someone,zitadel:${sub}`;
      const bySub = await app.request("/api/admin/stats", { headers: { cookie: sessionCookie } });
      assert.equal(bySub.status, 200);
    } finally {
      if (previous === undefined) delete process.env.MCTL_ACADEMY_STATS_ADMINS;
      else process.env.MCTL_ACADEMY_STATS_ADMINS = previous;
    }
  });

  test("is never merged into an existing GitHub user with the same e-mail", async () => {
    const githubEmail = `gh-${sub}@example.com`;
    const userId = randomUUID();
    const now = new Date();
    await authPool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "githubLogin", "createdAt", "updatedAt") VALUES ($1, 'octo', $2, true, 'octo-moderator', $3, $3)`,
      [userId, githubEmail, now],
    );
    await authPool.query(
      `INSERT INTO "account" (id, "userId", "providerId", "accountId", "createdAt", "updatedAt") VALUES ($1, $2, 'github', '583231', $3, $3)`,
      [randomUUID(), userId, now],
    );

    const response = await signIn({ sub: `${sub}9`, email: githubEmail, name: "Impostor" });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /error=/);
    assert.doesNotMatch(cookiesOf(response), /better-auth\.session_token=[^;]/);
    assert.deepEqual(await accountsFor(githubEmail), [
      { providerId: "github", accountId: "583231", githubLogin: "octo-moderator" },
    ]);
  });

  test("is never merged into an existing ZITADEL user with the same e-mail", async () => {
    // Self-registered ZITADEL users choose their own e-mail: another sub
    // presenting this user's address must not get this user's session.
    const response = await signIn({ sub: `${sub}7`, email, name: "Lookalike" });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /error=/);
    assert.doesNotMatch(cookiesOf(response), /better-auth\.session_token=[^;]/);
    assert.deepEqual(await accountsFor(email), [
      { providerId: "zitadel", accountId: sub, githubLogin: null },
    ]);
  });

  test("refuses an e-mail the issuer has not verified, so it cannot squat a GitHub learner's address", async () => {
    const squatted = `unverified-${sub}@example.com`;
    const response = await signIn({
      sub: `${sub}6`,
      email: squatted,
      name: "Squatter",
      email_verified: false,
    });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") ?? "", /error=/);
    assert.doesNotMatch(cookiesOf(response), /better-auth\.session_token=[^;]/);
    const { rows } = await authPool.query(`SELECT 1 FROM "user" WHERE email = $1`, [squatted]);
    assert.equal(rows.length, 0, "no user row may hold the unverified address");
  });

  test("refuses a callback whose ID token was not signed by the issuer", async () => {
    const original = issuer.idToken.bind(issuer);
    const stranger = new FakeZitadel();
    issuer.idToken = (claims) => stranger.idToken(claims, { key: { ...stranger.key, kid: issuer.key.kid } });
    try {
      const forgedEmail = `forged-${sub}@example.com`;
      const response = await signIn({ sub: `${sub}8`, email: forgedEmail, name: "Forged" });
      assert.equal(response.status, 302);
      assert.match(response.headers.get("location") ?? "", /error=/);
      assert.deepEqual(await accountsFor(forgedEmail), []);
    } finally {
      issuer.idToken = original;
    }
  });
});
