import { APIError } from "better-auth/api";
import { createLocalJWKSet, jwtVerify } from "jose";

/**
 * ZITADEL (auth.mctl.ai) as an optional third sign-in provider, next to
 * GitHub and Google — never instead of them. It goes through better-auth's
 * generic OAuth plugin (see server/auth.mjs); this module holds the three
 * things that plugin does not do on its own:
 *
 * 1. Configuration, read once. All of ZITADEL_ISSUER, ZITADEL_CLIENT_ID and
 *    ZITADEL_CLIENT_SECRET, or none. A half-set configuration is a boot
 *    error (assertZitadelConfigValid, called from app.mjs next to
 *    assertAuthSecretConfigured) rather than a silently missing button.
 *
 * 2. ID token verification. The plugin's default user-info step *decodes*
 *    the ID token without checking its signature. Here the signature is
 *    verified against the issuer's published keys (RS256 only), along with
 *    iss, aud/azp and expiry, before its `sub` is believed.
 *
 * 3. No account linking across the ZITADEL boundary. better-auth links a new
 *    provider account to an existing user whose e-mail matches. For
 *    ZITADEL that would hand a ZITADEL sign-in the GitHub user's session —
 *    including the githubLogin the moderator and stats-admin allowlists
 *    key on. refuseZitadelCrossLink makes that impossible in both
 *    directions: a ZITADEL account is only ever created for a user with no
 *    other account, and a GitHub/Google account never joins a ZITADEL user.
 *    A ZITADEL sign-in whose e-mail already belongs to a GitHub/Google user
 *    is therefore refused ("account not linked"), not merged.
 */

export const ZITADEL_PROVIDER_ID = "zitadel";

/** How long a discovery document or key set is reused before it is fetched again. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ config?: { issuer: string, clientId: string, clientSecret: string, displayName: string }, problem?: string }}
 */
export function readZitadelConfig(env) {
  const issuer = env.ZITADEL_ISSUER?.trim().replace(/\/+$/, "") || "";
  const clientId = env.ZITADEL_CLIENT_ID?.trim() || "";
  const clientSecret = env.ZITADEL_CLIENT_SECRET?.trim() || "";
  const set = [issuer, clientId, clientSecret].filter(Boolean).length;
  if (set === 0) return {};
  if (set < 3) {
    return {
      problem:
        "ZITADEL sign-in is partly configured: set all of ZITADEL_ISSUER, ZITADEL_CLIENT_ID " +
        "and ZITADEL_CLIENT_SECRET, or none of them.",
    };
  }
  let url;
  try {
    url = new URL(issuer);
  } catch {
    url = undefined;
  }
  if (!url || url.protocol !== "https:" || url.username || url.password) {
    return { problem: `ZITADEL_ISSUER must be an https URL, got ${JSON.stringify(issuer)}.` };
  }
  const displayName = env.ZITADEL_DISPLAY_NAME?.trim() || "ZITADEL";
  return { config: { issuer, clientId, clientSecret, displayName } };
}

async function fetchJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * Build the generic OAuth plugin's getUserInfo for ZITADEL.
 *
 * Any failure — unreachable issuer, a key that does not verify, a token for
 * another client — returns null, which the plugin turns into a redirect to
 * the error page ("user_info_is_missing"). Nothing is cached on failure.
 *
 * @param {{ issuer: string, clientId: string }} config
 * @param {{ fetch?: typeof fetch, logger?: Pick<Console, "error"> }} [deps]
 */
export function createZitadelUserInfo(config, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const logger = deps.logger ?? console;
  /** @type {{ value: any, at: number } | undefined} */
  let discovery;
  /** @type {{ value: any, at: number } | undefined} */
  let jwks;

  async function discover() {
    if (discovery && Date.now() - discovery.at < CACHE_TTL_MS) return discovery.value;
    const doc = await fetchJson(fetchImpl, `${config.issuer}/.well-known/openid-configuration`);
    const origin = new URL(config.issuer).origin;
    const endpoint = (name) => {
      const value = doc?.[name];
      if (typeof value !== "string" || new URL(value).origin !== origin || !value.startsWith("https:")) {
        throw new Error(`discovery ${name} is not https on the issuer origin`);
      }
      return value;
    };
    if (doc?.issuer !== config.issuer) throw new Error("discovery names another issuer");
    const value = { jwksUri: endpoint("jwks_uri"), userinfoEndpoint: endpoint("userinfo_endpoint") };
    discovery = { value, at: Date.now() };
    return value;
  }

  async function keySet(jwksUri, refresh) {
    if (!refresh && jwks && Date.now() - jwks.at < CACHE_TTL_MS) return jwks.value;
    const value = createLocalJWKSet(await fetchJson(fetchImpl, jwksUri));
    jwks = { value, at: Date.now() };
    return value;
  }

  async function verify(idToken, jwksUri) {
    const options = { issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"] };
    try {
      return (await jwtVerify(idToken, await keySet(jwksUri, false), options)).payload;
    } catch (err) {
      // The issuer rotated its keys since they were cached: look once more.
      if (err?.code !== "ERR_JWKS_NO_MATCHING_KEY") throw err;
      return (await jwtVerify(idToken, await keySet(jwksUri, true), options)).payload;
    }
  }

  return async function getZitadelUserInfo(tokens) {
    try {
      if (!tokens?.idToken) throw new Error("no ID token in the token response");
      const { jwksUri, userinfoEndpoint } = await discover();
      const claims = await verify(tokens.idToken, jwksUri);
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      // ZITADEL adds the project id as a second audience; the authorized
      // party must then be this client (OIDC Core §3.1.3.7).
      if ((audiences.length > 1 || claims.azp !== undefined) && claims.azp !== config.clientId) {
        throw new Error("ID token azp is not this client");
      }
      if (typeof claims.sub !== "string" || claims.sub === "") throw new Error("ID token has no sub");

      let profile = claims;
      if (typeof claims.email !== "string" || claims.email === "") {
        // The application may not put user info in the ID token; the
        // userinfo endpoint must then describe the same subject.
        profile = await fetchJson(fetchImpl, userinfoEndpoint, {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
        });
        if (profile?.sub !== claims.sub) throw new Error("userinfo describes another subject");
      }
      if (typeof profile.email !== "string" || profile.email === "") return null;
      const name =
        (typeof profile.name === "string" && profile.name) ||
        (typeof profile.preferred_username === "string" && profile.preferred_username) ||
        profile.email;
      return {
        id: claims.sub,
        email: profile.email,
        emailVerified: profile.email_verified === true,
        name,
        image: undefined,
      };
    } catch (err) {
      logger.error("[auth] ZITADEL sign-in refused:", err?.message ?? err);
      return null;
    }
  };
}

/**
 * databaseHooks.account.create.before: refuse any account row that would put
 * a ZITADEL account and a GitHub/Google account on the same user. Throwing
 * (not returning false) is what stops the sign-in: better-auth's implicit
 * link ignores a null result and would sign the caller in as the existing
 * user anyway, but turns a thrown error into "unable to link account".
 *
 * A failed lookup throws too: not being able to see the user's accounts is
 * not evidence that there are none.
 *
 * @param {{ query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ providerId: string }> }> }} pool
 * @param {{ userId: string, providerId: string }} account
 */
export async function refuseZitadelCrossLink(pool, account) {
  const { rows } = await pool.query(`SELECT "providerId" FROM "account" WHERE "userId" = $1`, [
    account.userId,
  ]);
  const incomingIsZitadel = account.providerId === ZITADEL_PROVIDER_ID;
  if (rows.some((row) => (row.providerId === ZITADEL_PROVIDER_ID) !== incomingIsZitadel)) {
    throw new APIError("FORBIDDEN", {
      message: "A ZITADEL sign-in cannot be linked to a GitHub or Google account, or the reverse.",
    });
  }
}
