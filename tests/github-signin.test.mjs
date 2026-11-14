import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * GitHub sign-in through the real better-auth handler and a real Postgres;
 * only GitHub's three endpoints are faked. The subject is githubLogin
 * (mctl-academy#209): the moderator and stats-admin allowlists key on it,
 * so it must be stored by the sign-in itself, before the session it issues
 * exists, and must not depend on anything the process keeps in memory.
 *
 * "Before the session exists" is observed in the database, not inferred: a
 * trigger records the user's githubLogin at the moment its session row is
 * inserted. A write that lands after the session (the old
 * session.create.after backfill) records NULL there even though the column
 * is set by the time the callback returns.
 */
process.env.GITHUB_CLIENT_ID ||= "ci-dummy-client-id";
process.env.GITHUB_CLIENT_SECRET ||= "ci-dummy-client-secret";

const EMAIL_DOMAIN = "github-signin.test";

class FakeGitHub {
  /** @type {Map<string, { profile: any, emails: any[] }>} code -> login */
  codes = new Map();
  /** @type {Map<string, { profile: any, emails: any[] }>} access token -> login */
  tokens = new Map();

  approve(code, { id, login, name = login }) {
    this.codes.set(code, {
      profile: { id, login, name, email: null, avatar_url: null },
      emails: [{ email: `${login}@${EMAIL_DOMAIN}`, primary: true, verified: true }],
    });
  }

  fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://github.com/login/oauth/access_token") {
      const body = new URLSearchParams(String(init.body ?? ""));
      const login = this.codes.get(body.get("code") ?? "");
      if (!login) return Response.json({ error: "bad_verification_code" });
      this.codes.delete(body.get("code") ?? "");
      const token = `gho_${randomUUID()}`;
      this.tokens.set(token, login);
      return Response.json({ access_token: token, token_type: "bearer", scope: "read:user,user:email" });
    }
    if (url === "https://api.github.com/user" || url === "https://api.github.com/user/emails") {
      const token = new Headers(init.headers).get("authorization")?.replace(/^Bearer /i, "") ?? "";
      const login = this.tokens.get(token);
      if (!login) return Response.json({ message: "Bad credentials" }, { status: 401 });
      return Response.json(url.endsWith("/emails") ? login.emails : login.profile);
    }
    return undefined;
  };
}

const github = new FakeGitHub();
const realFetch = globalThis.fetch;
globalThis.fetch = /** @type {typeof fetch} */ (
  async (input, init) => (await github.fetch(input, init)) ?? realFetch(input, init)
);

const { app } = await import("../server/app.mjs");
const { authPool } = await import("../server/auth.mjs");

function cookiesOf(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Sign in with GitHub as `identity`; returns the callback response. */
async function signIn(identity) {
  const start = await app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ provider: "github", callbackURL: "/" }),
  });
  assert.equal(start.status, 200, await start.clone().text());
  const authorize = new URL((await start.json()).url);
  assert.equal(authorize.origin + authorize.pathname, "https://github.com/login/oauth/authorize");

  const code = randomUUID();
  github.approve(code, identity);
  return app.request(
    `/api/auth/callback/github?${new URLSearchParams({ code, state: authorize.searchParams.get("state") ?? "" })}`,
    { headers: { cookie: cookiesOf(start) } },
  );
}

async function storedLogin(userId) {
  const { rows } = await authPool.query(`SELECT "githubLogin" FROM "user" WHERE id = $1`, [userId]);
  return rows[0]?.githubLogin;
}

async function userIdForGithubAccount(accountId) {
  const { rows } = await authPool.query(
    `SELECT "userId" FROM "account" WHERE "providerId" = 'github' AND "accountId" = $1`,
    [String(accountId)],
  );
  assert.equal(rows.length, 1, `exactly one GitHub account ${accountId}`);
  return rows[0].userId;
}

/** githubLogin as it was when each of the user's sessions was inserted. */
async function loginsAtSessionInsert(userId) {
  const { rows } = await authPool.query(
    `SELECT github_login FROM github_signin_test_session_login WHERE user_id = $1 ORDER BY seen_at`,
    [userId],
  );
  return rows.map((row) => row.github_login);
}

/** Ask a brand-new server process whether this session's user is a moderator. */
function moderatorStatusInFreshProcess(cookie, moderators) {
  const appUrl = new URL("../server/app.mjs", import.meta.url).href;
  const fixture = fileURLToPath(new URL("./helpers/client-dist-fixture.mjs", import.meta.url));
  const script = `
    const { app } = await import(${JSON.stringify(appUrl)});
    const res = await app.request("/api/reports", { headers: { cookie: ${JSON.stringify(cookie)} } });
    process.stdout.write("STATUS=" + res.status + "\\n");
    process.exit(0);
  `;
  const out = execFileSync(process.execPath, ["--import", fixture, "--input-type=module", "-e", script], {
    env: { ...process.env, MCTL_ACADEMY_MODERATORS: moderators },
    encoding: "utf8",
  });
  const match = /STATUS=(\d+)/.exec(out);
  assert.ok(match, `no status from the fresh process:\n${out}`);
  return Number(match[1]);
}

describe("GitHub sign-in stores githubLogin with the sign-in itself", () => {
  const run = Date.now();

  before(async () => {
    // Other suites share this database and insert sessions too; the
    // trigger records only users of this suite's e-mail domain.
    await authPool.query(`
      CREATE TABLE IF NOT EXISTS github_signin_test_session_login (
        user_id text NOT NULL,
        github_login text,
        seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )`);
    await authPool.query(`
      CREATE OR REPLACE FUNCTION github_signin_test_observe() RETURNS trigger AS $$
      BEGIN
        INSERT INTO github_signin_test_session_login (user_id, github_login)
          SELECT u.id, u."githubLogin" FROM "user" u
          WHERE u.id = NEW."userId" AND u.email LIKE '%@${EMAIL_DOMAIN}';
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await authPool.query(`
      CREATE OR REPLACE TRIGGER github_signin_test_observe BEFORE INSERT ON "session"
      FOR EACH ROW EXECUTE FUNCTION github_signin_test_observe()`);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await authPool.query(`DROP TRIGGER IF EXISTS github_signin_test_observe ON "session"`);
    await authPool.query(`DROP FUNCTION IF EXISTS github_signin_test_observe()`);
    await authPool.query(`DROP TABLE IF EXISTS github_signin_test_session_login`);
  });

  test("a fresh sign-in has the login stored before its session exists, and a fresh process still sees it", async () => {
    const id = run;
    const login = `octo-fresh-${run}`;
    const response = await signIn({ id, login });
    assert.equal(response.status, 302, await response.clone().text());
    assert.equal(response.headers.get("location"), "/");
    const cookie = cookiesOf(response);
    assert.match(cookie, /better-auth\.session_token=[^;]/);

    const userId = await userIdForGithubAccount(id);
    assert.equal(await storedLogin(userId), login);
    assert.deepEqual(await loginsAtSessionInsert(userId), [login]);

    // A restart: a new process, with none of this one's module state, both
    // reads the login and lets the allowlisted moderator through.
    assert.equal(moderatorStatusInFreshProcess(cookie, login), 200);
    assert.equal(moderatorStatusInFreshProcess(cookie, "someone-else"), 404);
  });

  test("a returning user whose login was never stored gets it before the session, and a rename is followed", async () => {
    // As a user created before the fix, or whose login a restart lost.
    const id = run + 1;
    const userId = randomUUID();
    const now = new Date();
    await authPool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, 'returning', $2, true, $3, $3)`,
      [userId, `octo-returning-${run}@${EMAIL_DOMAIN}`, now],
    );
    await authPool.query(
      `INSERT INTO "account" (id, "userId", "providerId", "accountId", "createdAt", "updatedAt") VALUES ($1, $2, 'github', $3, $4, $4)`,
      [randomUUID(), userId, String(id), now],
    );

    const first = await signIn({ id, login: `octo-returning-${run}` });
    assert.equal(first.status, 302, await first.clone().text());
    assert.equal(first.headers.get("location"), "/");
    assert.equal(await storedLogin(userId), `octo-returning-${run}`);

    const renamed = await signIn({ id, login: `octo-renamed-${run}` });
    assert.equal(renamed.status, 302);
    assert.equal(await storedLogin(userId), `octo-renamed-${run}`);

    assert.deepEqual(await loginsAtSessionInsert(userId), [`octo-returning-${run}`, `octo-renamed-${run}`]);
  });
});
