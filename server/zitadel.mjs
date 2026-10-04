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
 * 3. No account linking by e-mail for ZITADEL. better-auth links a new
 *    provider account to an existing user whose e-mail matches. For
 *    ZITADEL that would hand a ZITADEL sign-in someone else's session —
 *    a GitHub user's, with the githubLogin the moderator and stats-admin
 *    allowlists key on, or another ZITADEL user's, since self-registered
 *    ZITADEL users choose their own e-mail. refuseZitadelCrossLink makes
 *    that impossible: a ZITADEL account is only ever created for a user
 *    with no other account at all, and a GitHub/Google account never joins
 *    a ZITADEL user. A ZITADEL sign-in whose e-mail already belongs to any
 *    academy user is therefore refused ("account not linked"), not merged.
 *
 * 4. The e-mail is never the display name. PRIVACY.md promises the address
 *    is not displayed, and ZITADEL's login name defaults to the e-mail, so
 *    a name that looks like an address is skipped (zitadelDisplayName).
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
  /** @type {{ uri: string, value: any, at: number } | undefined} */
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
    // Keyed by the URI too: a discovery refresh that moves jwks_uri must not
    // keep serving the old location's keys until their own TTL runs out.
    if (!refresh && jwks?.uri === jwksUri && Date.now() - jwks.at < CACHE_TTL_MS) return jwks.value;
    const value = createLocalJWKSet(await fetchJson(fetchImpl, jwksUri));
    jwks = { uri: jwksUri, value, at: Date.now() };
    return value;
  }

  async function verify(idToken, jwksUri) {
    const options = {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ["RS256"],
      // jose checks exp only when it is present; an ID token must carry it.
      requiredClaims: ["exp", "iat", "sub"],
    };
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
      if (
        typeof claims.email !== "string" ||
        claims.email === "" ||
        typeof claims.email_verified !== "boolean"
      ) {
        // The application may not put user info (or only part of it) in the
        // ID token; the userinfo endpoint must then describe the same
        // subject, and its e-mail and email_verified are taken together.
        profile = await fetchJson(fetchImpl, userinfoEndpoint, {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
        });
        if (profile?.sub !== claims.sub) throw new Error("userinfo describes another subject");
      }
      if (typeof profile.email !== "string" || profile.email === "") return null;
      // An unverified address is refused, not just recorded: "user".email is
      // unique and refuseZitadelCrossLink keeps GitHub/Google off a ZITADEL
      // user, so a self-registered ZITADEL account on someone else's address
      // would lock that person out of their first GitHub/Google sign-in here.
      if (profile.email_verified !== true) throw new Error("ZITADEL e-mail is not verified");
      return {
        id: claims.sub,
        email: profile.email,
        emailVerified: true,
        name: zitadelDisplayName(profile),
        image: undefined,
      };
    } catch (err) {
      logger.error("[auth] ZITADEL sign-in refused:", err?.message ?? err);
      return null;
    }
  };
}

/** Anything with an address-shaped word in it, e.g. "a@b.co" or "Zed <a@b.co>". */
const LOOKS_LIKE_EMAIL = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/;

/** Shown when a ZITADEL profile has no name that is not an e-mail address. */
export const ZITADEL_FALLBACK_NAME = "Learner";

/**
 * The name to show for a ZITADEL user: its display name, else its login
 * name, but never anything that looks like an e-mail address (ZITADEL's
 * login name is the e-mail by default), else a neutral placeholder.
 *
 * @param {Record<string, unknown>} profile
 */
export function zitadelDisplayName(profile) {
  for (const candidate of [profile.name, profile.given_name, profile.preferred_username]) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (value !== "" && !LOOKS_LIKE_EMAIL.test(value)) return value;
  }
  return ZITADEL_FALLBACK_NAME;
}

/**
 * databaseHooks.account.create.before: refuse any account row that would
 * attach a ZITADEL account to an existing user (of any provider, ZITADEL
 * included), or a GitHub/Google account to a ZITADEL user. Throwing (not
 * returning false) is what stops the sign-in: better-auth's implicit link
 * ignores a null result and would sign the caller in as the existing user
 * anyway, but turns a thrown error into "unable to link account".
 *
 * A returning ZITADEL user is not affected: better-auth finds its account by
 * (providerId, accountId) and creates nothing.
 *
 * A failed lookup throws too: not being able to see the user's accounts is
 * not evidence that there are none.
 *
 * @param {(userId: string) => Promise<string[]>} listProviderIds the providers of the user's existing accounts
 * @param {{ userId: string, providerId: string }} account
 */
export async function refuseZitadelCrossLink(listProviderIds, account) {
  const existing = await listProviderIds(account.userId);
  const refused =
    account.providerId === ZITADEL_PROVIDER_ID ? existing.length > 0 : existing.includes(ZITADEL_PROVIDER_ID);
  if (refused) {
    throw new APIError("FORBIDDEN", {
      message: "A ZITADEL sign-in cannot be linked to an existing account, or the reverse.",
    });
  }
}
