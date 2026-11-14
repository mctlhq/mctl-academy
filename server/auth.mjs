import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import pg from "pg";
import { dbSslConfig } from "./db-ssl.mjs";
import {
  ZITADEL_CALLBACK_PATH,
  ZITADEL_PROVIDER_ID,
  createZitadelUserInfo,
  readZitadelConfig,
  refuseZitadelCrossLink,
} from "./zitadel.mjs";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

// No DATABASE_URL guard here, deliberately: server/routes/attempts.mjs and
// server/routes/account.mjs both import this module statically, and ES
// module imports are hoisted — their static `import "../auth.mjs"` runs
// before app.mjs's own top-level code (including its initDb() try/catch)
// gets a chance to. A throw here would fire as an unhandled top-level
// exception, bypassing that try/catch's clean "[db] Fatal:" + process.exit(1)
// entirely. The DATABASE_URL-is-required check lives in db.mjs's initDb()
// instead, which every one of this module's importers transitively waits on
// first (app.mjs awaits it before touching anything auth-related) — pg.Pool
// itself doesn't validate or connect at construction time, so building one
// here with an unset connection string is inert until actually queried, by
// which point initDb() has already either succeeded or exited the process.
//
// Shared with server/routes/account.mjs for self-service deletion — see
// there for why that route reads "user" directly instead of going through
// better-auth's own admin-only removeUser API.
export const authPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: dbSslConfig(isProduction),
});

// Same reason as db.mjs's pool.on("error"): an idle client whose backend
// goes away emits "error", and an unhandled "error" event kills the process.
// better-auth 1.7 checks its schema when it initializes, so this pool now
// holds an idle connection from boot on, not only after the first sign-in;
// without this handler a database blip crashed the pod instead of failing
// /readyz (tests/readyz-live.test.mjs).
authPool.on("error", (err) => {
  console.error("[auth] Idle client error:", err.message);
});

/**
 * Called explicitly from app.mjs's initDb() try/catch, not run at module
 * load — same hoisting reasoning as the comment above. better-auth signs
 * session cookies with a public, hardcoded dev secret when BETTER_AUTH_SECRET
 * is unset; in production that would let anyone forge a valid session cookie
 * for any user id, silently (no error, no log line — sign-in just "works").
 * BETTER_AUTH_SECRET is one of four values this app's manual deploy checklist
 * asks an operator to push via secret_env_vars, so treating a missing one as
 * fatal-at-boot (like DATABASE_URL) is the only way to be sure it's not
 * quietly skipped.
 */
export function assertAuthSecretConfigured() {
  if (isProduction && !process.env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set in production. Refusing to start: better-auth " +
        "would otherwise sign session cookies with its own public, hardcoded dev " +
        "secret, letting anyone forge a valid session for any user.",
    );
  }
}

/**
 * ZITADEL is optional: registered only when all three of its variables are
 * set. A half-set configuration registers nothing here and fails the boot in
 * assertZitadelConfigValid (called from app.mjs next to the secret check) —
 * not at module load, for the same hoisting reason as above.
 */
const zitadel = readZitadelConfig(process.env);

export function assertZitadelConfigValid() {
  if (zitadel.problem) throw new Error(zitadel.problem);
}

/** What the client needs to decide which sign-in buttons to show. */
export function zitadelSignIn() {
  return zitadel.config ? { providerId: ZITADEL_PROVIDER_ID, label: zitadel.config.displayName } : null;
}

/**
 * githubLogin is stored as a custom field because MCTL_ACADEMY_MODERATORS
 * (see app.mjs) allowlists by GitHub username, and better-auth's built-in
 * user table has no such column — only name/email/image, none of which is
 * guaranteed to be the GitHub login.
 *
 * It is deliberately declared `input: false` below: better-auth's public
 * POST /api/auth/update-user accepts any additionalField that isn't marked
 * input: false, and this field gates the moderator/admin-stats allowlists —
 * if it were writable there, any signed-in user could self-elevate by
 * PATCHing their own githubLogin to an allowlisted name.
 *
 * The cost of that is that better-auth's own OAuth-profile mapping
 * (mapProfileToUser below) is filtered by that exact same `input: false`
 * flag before the value ever reaches the DB — better-auth has no separate
 * "settable by the provider, not by the user" flag, so the profile-mapped
 * value is silently dropped on both signup and sign-in, and githubLogin
 * stays null forever. (Discovered 2026-08-10: the admin-stats/moderator
 * gates 404'd for an allowlisted, signed-in user because of this.)
 *
 * So the login is written by this module, not by better-auth's field
 * system, and the update-user endpoint's protection is untouched. It is
 * written synchronously, as part of the sign-in that maps the GitHub
 * account, before that sign-in's session exists:
 *
 * - a first sign-in: user.create.before puts it into the INSERT of the user
 *   row, in the same transaction that creates the GitHub account row;
 * - a returning (or newly e-mail-linked) user: session.create.before sets it
 *   on the existing row before the session row is written. That also
 *   self-heals a row whose login is missing or stale (a renamed GitHub
 *   account).
 *
 * mapProfileToUser hands the login to those hooks through request-scoped
 * state (githubSignInScope), not through anything that outlives the
 * request: an earlier in-process Map keyed by account id was lost on a
 * restart and was invisible to a second replica, and it was drained by a
 * best-effort session.create.after hook, so a moderator could sign in and
 * still not be recognised (mctl-academy#209).
 */

/** @type {AsyncLocalStorage<{ githubLogin?: string, persisted?: boolean }>} */
const githubSignInScope = new AsyncLocalStorage();

/**
 * mapProfileToUser for GitHub: remember the login for this request's hooks.
 * Outside a handleAuthRequest scope there is nowhere to keep it, and a
 * sign-in that cannot store the login must not pass for one that has none:
 * the allowlists would then quietly fail shut for an allowlisted user.
 *
 * @param {{ login?: unknown }} profile
 */
function rememberGithubLogin(profile) {
  const scope = githubSignInScope.getStore();
  if (!scope) throw new Error("GitHub sign-in outside handleAuthRequest: githubLogin cannot be stored");
  if (typeof profile.login !== "string" || profile.login === "") {
    throw new Error("GitHub profile has no login");
  }
  scope.githubLogin = profile.login;
  return { githubLogin: profile.login };
}

export const auth = betterAuth({
  database: authPool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [process.env.PUBLIC_BASE_URL].filter(Boolean),
  user: {
    additionalFields: {
      githubLogin: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  account: {
    // The app never calls the GitHub/Google API again after login, so the
    // stored access/refresh tokens are pure liability if the DB ever leaks.
    encryptOAuthTokens: true,
  },
  // better-auth's session table has ipAddress/userAgent columns, and its
  // internal-adapter unconditionally populates both on every sign-in (see
  // node_modules/better-auth/dist/db/internal-adapter.mjs's createSession) —
  // there is no top-level option to disable capturing them, only this
  // per-write hook. PRIVACY.md commits to "the minimum needed... and nothing
  // else"; this app has no use for either field (no security dashboards, no
  // "sign out other devices" UI), so scrubbing them before they're written
  // keeps the promise rather than requiring a PRIVACY.md rewrite to match
  // better-auth's own defaults.
  databaseHooks: {
    // A first GitHub sign-in: the login goes into the user row's own INSERT.
    user: {
      create: {
        before: async (user) => {
          const scope = githubSignInScope.getStore();
          if (!scope?.githubLogin) return;
          scope.persisted = true;
          return { data: { ...user, githubLogin: scope.githubLogin } };
        },
      },
    },
    session: {
      create: {
        before: async (session, ctx) => {
          // A returning GitHub user: the login is set before the session
          // row exists. Through the adapter in use, so a transaction, if
          // one is open, is not waited on from a second pool client. A
          // failure fails the sign-in rather than issuing a session whose
          // user the allowlists cannot recognise.
          const scope = githubSignInScope.getStore();
          if (scope?.githubLogin && !scope.persisted) {
            const fallback = ctx?.context?.adapter;
            const adapter = fallback ? await getCurrentAdapter(fallback) : undefined;
            if (!adapter) throw new Error("no database adapter to store githubLogin with");
            await adapter.update({
              model: "user",
              where: [{ field: "id", value: session.userId }],
              update: { githubLogin: scope.githubLogin },
            });
            scope.persisted = true;
          }
          return { data: { ...session, ipAddress: null, userAgent: null } };
        },
      },
    },
    // See server/zitadel.mjs: no implicit e-mail linking across the ZITADEL
    // boundary, in either direction. GitHub <-> Google linking is unchanged.
    account: {
      create: {
        before: async (account, ctx) => {
          await refuseZitadelCrossLink(async (userId) => {
            // A first sign-in creates the user and the account in one
            // better-auth transaction. Asking through that transaction's
            // adapter keeps the lookup on the connection already held,
            // rather than waiting on a second pool client per sign-up.
            const fallback = ctx?.context?.adapter;
            const adapter = fallback ? await getCurrentAdapter(fallback) : undefined;
            if (adapter) {
              const rows = await adapter.findMany({
                model: "account",
                where: [{ field: "userId", value: userId }],
              });
              return rows.map((row) => row.providerId);
            }
            // Reached only when the hook runs outside any endpoint context,
            // which better-auth's own sign-in paths never do; kept so such a
            // caller still gets an answer rather than a crash.
            const { rows } = await authPool.query(`SELECT "providerId" FROM "account" WHERE "userId" = $1`, [
              userId,
            ]);
            return rows.map((row) => row.providerId);
          }, account);
        },
      },
    },
  },
  // Only registering a provider when both its id and secret are actually
  // set — rather than defaulting missing values to "" — so an unconfigured
  // environment gets better-auth's own clean "provider not found" error
  // instead of silently attempting an OAuth handshake with empty
  // credentials, which the old hand-rolled route's explicit 503 avoided and
  // this should too.
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            // better-auth drops the returned githubLogin (input: false);
            // the hooks above store it. See the comment above
            // githubSignInScope.
            mapProfileToUser: rememberGithubLogin,
          },
        }
      : {}),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  plugins: zitadel.config
    ? [
        genericOAuth({
          config: [
            {
              providerId: ZITADEL_PROVIDER_ID,
              // better-auth 1.7 takes the expected issuer from this document
              // (it dropped the `issuer` option) and rejects a callback whose
              // `iss` names another one; the document is the issuer's own,
              // and createZitadelUserInfo checks that it names this issuer.
              discoveryUrl: `${zitadel.config.issuer}/.well-known/openid-configuration`,
              // Without discovery's issuer and JWKS the plugin would register
              // the provider with no ID-token verification of its own; skip
              // it instead (the plugin retries discovery on the next request).
              requireIdTokenVerification: true,
              // The URI registered in ZITADEL, not 1.7's default
              // /api/auth/callback/zitadel; handleAuthRequest forwards it.
              redirectURI: zitadel.config.redirectURI,
              clientId: zitadel.config.clientId,
              clientSecret: zitadel.config.clientSecret,
              authentication: "basic",
              scopes: ["openid", "email", "profile"],
              pkce: true,
              // The account id stays the verified ID-token `sub`, as in 1.6.
              // 1.7's default for an OIDC provider reads `profile.sub`, which
              // createZitadelUserInfo does not return; naming it here keeps
              // the account key independent of how discovery went.
              accountSubject: ({ profile }) => {
                if (typeof profile.id !== "string" || profile.id === "") {
                  throw new Error("ZITADEL profile has no verified subject");
                }
                return profile.id;
              },
              getUserInfo: createZitadelUserInfo(zitadel.config),
              // Never a githubLogin: the allowlists name a ZITADEL user only
              // as zitadel:<sub> (server/allowlist.mjs).
              mapProfileToUser: () => ({}),
            },
          ],
        }),
      ]
    : [],
});

/**
 * The /api/auth/* handler. Everything goes to better-auth unchanged except
 * ZITADEL's registered callback path, which better-auth 1.7 no longer
 * mounts: it is served by the shared callback route for the same provider,
 * with the query (code, state, iss) intact. Only when ZITADEL is
 * configured; otherwise the path stays a 404 like any unknown route.
 *
 * Every request runs in its own githubSignInScope; a GitHub sign-in through
 * any other entry point refuses to complete (rememberGithubLogin).
 *
 * @param {Request} request
 */
export function handleAuthRequest(request) {
  const url = new URL(request.url);
  if (zitadel.config && url.pathname === ZITADEL_CALLBACK_PATH) {
    url.pathname = `/api/auth/callback/${ZITADEL_PROVIDER_ID}`;
    request = new Request(url, request);
  }
  // One scope per request: what a GitHub sign-in maps is visible to that
  // sign-in's database hooks and to nothing else.
  return githubSignInScope.run({}, () => auth.handler(request));
}
