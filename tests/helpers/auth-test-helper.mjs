import { randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { authPool } from "../../server/auth.mjs";

/**
 * Builds a valid `Cookie` header for an authenticated request without going
 * through a real GitHub/Google OAuth round trip — E2E covers that path with
 * a mocked provider (see the plan's Track D). This inserts a user + session
 * row directly into better-auth's own tables and signs the session token the
 * same way better-auth's cookie-builder test-utils does (see
 * node_modules/better-auth/dist/plugins/test-utils/cookie-builder.mjs — not
 * used directly because it depends on vitest's `afterAll`, incompatible with
 * this project's `node --test` runner), so it verifies through the exact
 * same auth.api.getSession() signature check every real request goes
 * through.
 *
 * @param {object} identity
 * @param {string} identity.githubLogin
 * @param {string} [identity.email] Optional, and no caller passes it today:
 *   the default below mirrors GitHub's own noreply address, which is what a
 *   real sign-in yields for a user with a private email. Supply it only when
 *   a test is specifically about the address.
 */
export async function authedCookie({ githubLogin, email }) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET must be set for tests that authenticate.");
  }

  const userId = randomUUID();
  const now = new Date();

  await authPool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "githubLogin", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, $4, $5, $5);`,
    [userId, githubLogin, email || `${githubLogin}@users.noreply.github.com`, githubLogin, now],
  );

  const token = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await authPool.query(
    `INSERT INTO "session" (id, "userId", token, "expiresAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $5);`,
    [randomUUID(), userId, token, expiresAt, now],
  );

  const signature = await makeSignature(token, secret);
  return `better-auth.session_token=${token}.${signature}`;
}
