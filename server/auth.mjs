import { betterAuth } from "better-auth";
import pg from "pg";
import { dbSslConfig } from "./db-ssl.mjs";

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
        "secret, letting anyone forge a valid session for any user."
    );
  }
}

/**
 * githubLogin is stored as a custom field because MCTL_ACADEMY_MODERATORS
 * (see app.mjs) allowlists by GitHub username, and better-auth's built-in
 * user table has no such column — only name/email/image, none of which is
 * guaranteed to be the GitHub login.
 */
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
            mapProfileToUser: (profile) => ({
              githubLogin: profile.login,
            }),
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
});
