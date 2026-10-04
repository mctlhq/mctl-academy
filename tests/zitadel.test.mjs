import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createZitadelUserInfo,
  readZitadelConfig,
  refuseZitadelCrossLink,
  zitadelDisplayName,
  ZITADEL_FALLBACK_NAME,
} from "../server/zitadel.mjs";
import { parseAllowlist, isAllowlisted, warnIgnoredAllowlistEntries } from "../server/allowlist.mjs";
import { FakeZitadel } from "./helpers/fake-zitadel.mjs";

const silent = { error: () => {} };

describe("readZitadelConfig", () => {
  const full = {
    ZITADEL_ISSUER: "https://auth.mctl.ai/",
    ZITADEL_CLIENT_ID: " zid ",
    ZITADEL_CLIENT_SECRET: " zsecret ",
  };

  test("is off, with no problem, when none of its variables are set", () => {
    assert.deepEqual(readZitadelConfig({}), {});
  });

  test("normalises a complete configuration", () => {
    assert.deepEqual(readZitadelConfig(full), {
      config: {
        issuer: "https://auth.mctl.ai",
        clientId: "zid",
        clientSecret: "zsecret",
        displayName: "ZITADEL",
      },
    });
    assert.equal(
      readZitadelConfig({ ...full, ZITADEL_DISPLAY_NAME: "MCTL account" }).config.displayName,
      "MCTL account",
    );
  });

  test("reports a half-set configuration instead of silently dropping it", () => {
    assert.match(readZitadelConfig({ ZITADEL_CLIENT_ID: "zid" }).problem, /partly configured/);
    assert.match(readZitadelConfig({ ...full, ZITADEL_CLIENT_SECRET: "" }).problem, /partly configured/);
  });

  test("reports an issuer that is not https", () => {
    assert.match(readZitadelConfig({ ...full, ZITADEL_ISSUER: "http://auth.mctl.ai" }).problem, /https URL/);
    assert.match(readZitadelConfig({ ...full, ZITADEL_ISSUER: "auth.mctl.ai" }).problem, /https URL/);
  });
});

describe("ZITADEL ID token verification (getUserInfo)", () => {
  /** @type {FakeZitadel} */
  let issuer;
  /** @type {(tokens: any) => Promise<any>} */
  let getUserInfo;

  beforeEach(() => {
    issuer = new FakeZitadel();
    getUserInfo = createZitadelUserInfo(
      { issuer: issuer.issuer, clientId: issuer.clientId },
      { fetch: /** @type {any} */ (issuer.fetch), logger: silent },
    );
  });

  test("returns the verified sub as the account id, with the e-mail and name", async () => {
    const idToken = await issuer.idToken({
      sub: "290001",
      email: "a@example.com",
      email_verified: true,
      name: "A",
    });
    assert.deepEqual(await getUserInfo({ idToken, accessToken: "at" }), {
      id: "290001",
      email: "a@example.com",
      emailVerified: true,
      name: "A",
      image: undefined,
    });
  });

  test("never passes the e-mail through as the name", async () => {
    const idToken = await issuer.idToken({
      sub: "290001",
      email: "a@example.com",
      preferred_username: "a@example.com",
    });
    assert.equal((await getUserInfo({ idToken, accessToken: "at" })).name, ZITADEL_FALLBACK_NAME);
  });

  test("refuses an e-mail the issuer has not verified", async () => {
    for (const email_verified of [false, undefined, "true"]) {
      const idToken = await issuer.idToken({ sub: "1", email: "a@example.com", email_verified });
      assert.equal(await getUserInfo({ idToken }), null, `email_verified=${email_verified}`);
    }
  });

  test("reads email_verified from userinfo when the ID token has the e-mail without it", async () => {
    const idToken = await issuer.idToken({ sub: "1", email: "a@example.com", email_verified: undefined });
    issuer.userinfo.set("verified", { sub: "1", email: "a@example.com", email_verified: true });
    assert.equal((await getUserInfo({ idToken, accessToken: "verified" }))?.emailVerified, true);
    issuer.userinfo.set("unverified", { sub: "1", email: "a@example.com", email_verified: false });
    assert.equal(await getUserInfo({ idToken, accessToken: "unverified" }), null);
    // A token that does say email_verified is believed without the extra call.
    const hits = issuer.hits.userinfo;
    await getUserInfo({ idToken: await issuer.idToken({ sub: "1", email: "a@example.com" }) });
    assert.equal(issuer.hits.userinfo, hits);
  });

  test("refuses an ID token without an expiry", async () => {
    const idToken = await issuer.idToken({ sub: "1", email: "a@example.com", exp: undefined });
    assert.equal(await getUserInfo({ idToken }), null);
  });

  test("falls back to userinfo for the e-mail, for the same subject only", async () => {
    issuer.userinfo.set("at", {
      sub: "290001",
      email: "a@example.com",
      email_verified: true,
      preferred_username: "a",
    });
    const idToken = await issuer.idToken({ sub: "290001" });
    assert.equal((await getUserInfo({ idToken, accessToken: "at" })).email, "a@example.com");

    issuer.userinfo.set("other", { sub: "290002", email: "b@example.com", email_verified: true });
    assert.equal(await getUserInfo({ idToken, accessToken: "other" }), null);
  });

  test("refuses a token response without an ID token", async () => {
    assert.equal(await getUserInfo({ accessToken: "at" }), null);
  });

  test("refuses another issuer, another audience, or another authorized party", async () => {
    const claims = { sub: "1", email: "a@example.com" };
    assert.equal(
      await getUserInfo({ idToken: await issuer.idToken({ ...claims, iss: "https://evil.example.com" }) }),
      null,
    );
    assert.equal(
      await getUserInfo({ idToken: await issuer.idToken({ ...claims, aud: "other", azp: undefined }) }),
      null,
    );
    assert.equal(
      await getUserInfo({ idToken: await issuer.idToken({ ...claims, azp: "project-id" }) }),
      null,
    );
    assert.notEqual(
      await getUserInfo({
        idToken: await issuer.idToken({ ...claims, aud: issuer.clientId, azp: undefined }),
      }),
      null,
    );
  });

  test("refuses an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    assert.equal(
      await getUserInfo({
        idToken: await issuer.idToken({ sub: "1", email: "a@x", iat: past, exp: past + 60 }),
      }),
      null,
    );
  });

  test("refuses a token signed by a key the issuer does not publish", async () => {
    const stranger = new FakeZitadel();
    const idToken = await stranger.idToken(
      { sub: "1", email: "a@example.com" },
      { key: { ...stranger.key, kid: "kid-1" } },
    );
    assert.equal(await getUserInfo({ idToken }), null);
  });

  test("refuses a token whose payload was edited after signing", async () => {
    const idToken = await issuer.idToken({ sub: "1", email: "a@example.com" });
    const [header, payload, signature] = idToken.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString());
    edited.sub = "2";
    const forged = `${header}.${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`;
    assert.equal(await getUserInfo({ idToken: forged }), null);
  });

  test("refuses alg none, whatever the header says", async () => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "none" })}.${encode({
      iss: issuer.issuer,
      aud: issuer.clientId,
      sub: "1",
      email: "a@example.com",
      iat: now,
      exp: now + 60,
    })}.`;
    assert.equal(await getUserInfo({ idToken: unsigned }), null);
  });

  test("re-fetches the key set once when the issuer has rotated its key", async () => {
    await getUserInfo({ idToken: await issuer.idToken({ sub: "1", email: "a@example.com" }) });
    assert.equal(issuer.hits.jwks, 1);
    issuer.rotateKey("kid-2");
    const after = await getUserInfo({ idToken: await issuer.idToken({ sub: "1", email: "a@example.com" }) });
    assert.equal(after?.id, "1");
    assert.equal(issuer.hits.jwks, 2);
  });

  test("fetches the key set again when discovery moves jwks_uri", async () => {
    let now = Date.now();
    const realNow = Date.now;
    Date.now = () => now;
    try {
      await getUserInfo({ idToken: await issuer.idToken({ sub: "1", email: "a@example.com" }) });
      // Half an hour later a key rotation refreshes the key set, so it is
      // still fresh when the discovery document expires below.
      now += 30 * 60 * 1000;
      issuer.rotateKey("kid-2");
      await getUserInfo({ idToken: await issuer.idToken({ sub: "1", email: "a@example.com" }) });
      assert.equal(issuer.hits.jwks, 2);
      // Past the discovery TTL only: discovery is re-read and names a new URI.
      now += 31 * 60 * 1000;
      const moved = `${issuer.issuer}/oauth/v2/keys?moved=1`;
      issuer.discovery = { jwks_uri: moved };
      const idToken = await issuer.idToken({ sub: "1", email: "a@example.com" });
      assert.equal((await getUserInfo({ idToken }))?.id, "1");
      assert.equal(issuer.jwksUrls.at(-1), moved);
      assert.equal(issuer.hits.jwks, 3);
    } finally {
      Date.now = realNow;
    }
  });

  test("refuses a discovery document naming another issuer, or endpoints off its origin", async () => {
    const idToken = await issuer.idToken({ sub: "1", email: "a@example.com" });
    issuer.discovery = { issuer: "https://evil.example.com" };
    assert.equal(await getUserInfo({ idToken }), null);
    issuer.discovery = { jwks_uri: "https://evil.example.com/keys" };
    assert.equal(await getUserInfo({ idToken }), null);
    // Nothing was cached from the refused documents.
    issuer.discovery = {};
    assert.equal((await getUserInfo({ idToken }))?.id, "1");
  });
});

describe("refuseZitadelCrossLink", () => {
  const listing = (providers) => async () => providers;

  test("allows the first account of a new user, whatever the provider", async () => {
    await refuseZitadelCrossLink(listing([]), { userId: "u", providerId: "zitadel" });
    await refuseZitadelCrossLink(listing([]), { userId: "u", providerId: "github" });
  });

  test("leaves GitHub <-> Google linking as it was", async () => {
    await refuseZitadelCrossLink(listing(["github"]), { userId: "u", providerId: "google" });
  });

  test("refuses a ZITADEL account on a GitHub/Google user, and the reverse", async () => {
    await assert.rejects(
      refuseZitadelCrossLink(listing(["github"]), { userId: "u", providerId: "zitadel" }),
      /cannot be linked/,
    );
    await assert.rejects(
      refuseZitadelCrossLink(listing(["zitadel"]), { userId: "u", providerId: "github" }),
      /cannot be linked/,
    );
  });

  test("refuses a second ZITADEL account on a ZITADEL user (same e-mail, another sub)", async () => {
    await assert.rejects(
      refuseZitadelCrossLink(listing(["zitadel"]), { userId: "u", providerId: "zitadel" }),
      /cannot be linked/,
    );
  });

  test("refuses when the user's accounts cannot be read", async () => {
    const broken = async () => Promise.reject(new Error("connection refused"));
    await assert.rejects(
      refuseZitadelCrossLink(broken, { userId: "u", providerId: "zitadel" }),
      /connection refused/,
    );
  });
});

describe("zitadelDisplayName", () => {
  test("uses the name, then the given name, then the login name", () => {
    assert.equal(
      zitadelDisplayName({ name: "Zed Z", given_name: "Zed", preferred_username: "zed" }),
      "Zed Z",
    );
    assert.equal(zitadelDisplayName({ given_name: "Zed", preferred_username: "zed" }), "Zed");
    assert.equal(zitadelDisplayName({ preferred_username: "zed" }), "zed");
    // An "@" alone is not an address.
    assert.equal(zitadelDisplayName({ name: "Zed @ MCTL" }), "Zed @ MCTL");
    assert.equal(zitadelDisplayName({ name: "@zed" }), "@zed");
  });

  test("never uses anything that looks like an e-mail address", () => {
    assert.equal(
      zitadelDisplayName({
        name: "a@example.com",
        preferred_username: "a@example.com",
        email: "a@example.com",
      }),
      ZITADEL_FALLBACK_NAME,
    );
    assert.equal(zitadelDisplayName({ email: "a@example.com" }), ZITADEL_FALLBACK_NAME);
    assert.equal(
      zitadelDisplayName({ name: "  ", preferred_username: "a@example.com", given_name: "A" }),
      "A",
    );
  });
});

describe("allowlist entries", () => {
  test("plain entries are GitHub logins; zitadel:<sub> entries are ZITADEL users; other prefixes are ignored", () => {
    const { githubLogins, zitadelSubs, ignored } = parseAllowlist(
      " MashkovD , zitadel:290001 ,okta:x, ZITADEL:290002,zitadel:",
    );
    assert.deepEqual([...githubLogins], ["mashkovd"]);
    assert.deepEqual([...zitadelSubs], ["290001", "290002"]);
    assert.deepEqual(ignored, ["okta:x", "zitadel:"]);
  });

  test("the boot names every ignored entry, and stays quiet when there is none", () => {
    const warnings = [];
    const logger = { warn: (message) => warnings.push(message) };
    warnIgnoredAllowlistEntries(
      { MCTL_ACADEMY_MODERATORS: "mashkovd,github:octocat", MCTL_ACADEMY_STATS_ADMINS: "zitadel:1" },
      logger,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /MCTL_ACADEMY_MODERATORS: ignoring "github:octocat"/);
    warnIgnoredAllowlistEntries({ MCTL_ACADEMY_MODERATORS: "mashkovd" }, logger);
    warnIgnoredAllowlistEntries({}, logger);
    assert.equal(warnings.length, 1);
  });

  test("a ZITADEL user is listed only through its own zitadel account row, never by name or e-mail", async () => {
    const queries = [];
    const pool = {
      query: async (sql, params) => {
        queries.push(params);
        return { rows: params[0] === "zuser" && params[2].includes("290001") ? [{}] : [] };
      },
    };
    const zitadelUser = {
      user: { id: "zuser", githubLogin: null, name: "mashkovd", email: "mashkovd@example.com" },
    };
    assert.equal(await isAllowlisted(zitadelUser, "mashkovd", pool), false);
    assert.equal(queries.length, 0, "no zitadel entries, no lookup");
    assert.equal(await isAllowlisted(zitadelUser, "mashkovd,zitadel:290001", pool), true);
    assert.equal(await isAllowlisted(zitadelUser, "zitadel:290002", pool), false);
    assert.deepEqual(queries.at(-1), ["zuser", "zitadel", ["290002"]]);
  });

  test("GitHub entries keep matching as before, and no session is never listed", async () => {
    const pool = { query: async () => ({ rows: [] }) };
    assert.equal(await isAllowlisted({ user: { id: "g", githubLogin: "MashkovD" } }, "mashkovd", pool), true);
    assert.equal(await isAllowlisted(null, "mashkovd", pool), false);
    assert.equal(await isAllowlisted({ user: { id: "g", githubLogin: "other" } }, "", pool), false);
  });

  test("a failed lookup throws rather than answering either way", async () => {
    const broken = { query: async () => Promise.reject(new Error("db down")) };
    await assert.rejects(isAllowlisted({ user: { id: "z" } }, "zitadel:1", broken), /db down/);
  });
});
