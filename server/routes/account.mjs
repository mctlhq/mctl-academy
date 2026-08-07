import { Hono } from "hono";
import { auth, authPool } from "../auth.mjs";
import { requireSameOrigin } from "../middleware/csrf.mjs";

export const accountRouter = new Hono();

/**
 * DELETE /api/account - Self-service account deletion (GDPR Art 17).
 *
 * Deliberately not better-auth's own authClient.deleteUser(): that flow
 * requires email verification by default (sendDeleteAccountVerification),
 * which this app has no infrastructure for. Also not auth.api.removeUser —
 * that is part of the admin plugin, gated on an admin role, and designed for
 * an operator acting on another user's account, not this self-only case.
 *
 * Deleting the "user" row directly is safe and sufficient: session and
 * account both have ON DELETE CASCADE to it (better-auth's own schema), and
 * attempts.user_id / question_reports.reporter_user_id cascade or null out
 * per the FKs added in migrations/1754607600000_better-auth-schema.mjs.
 */
accountRouter.delete("/", requireSameOrigin, async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) {
    return c.json({ error: "Authentication required" }, 401);
  }

  await authPool.query('DELETE FROM "user" WHERE id = $1', [session.user.id]);

  return c.json({ success: true, message: "Account deleted." });
});
