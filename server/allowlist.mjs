import { ZITADEL_PROVIDER_ID } from "./zitadel.mjs";

/**
 * The privileged-role allowlists (MCTL_ACADEMY_MODERATORS,
 * MCTL_ACADEMY_STATS_ADMINS): comma-separated, one entry per person.
 *
 * - `login` (no prefix) is a GitHub login, compared case-insensitively with
 *   the session user's githubLogin — exactly the old behaviour, so existing
 *   values keep working unchanged.
 * - `zitadel:<sub>` is a ZITADEL user, matched by the immutable ZITADEL user
 *   id on the user's linked `zitadel` account row. Never by e-mail or name:
 *   either can be chosen at self-registration, so matching on them would let
 *   anyone register their way onto the list.
 *
 * Any other `provider:` prefix is ignored rather than guessed at, so a typo
 * fails shut.
 *
 * @param {string | undefined} raw
 */
export function parseAllowlist(raw) {
  const githubLogins = new Set();
  const zitadelSubs = new Set();
  for (const entry of (raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator === -1) {
      githubLogins.add(entry.toLowerCase());
    } else if (entry.slice(0, separator).toLowerCase() === ZITADEL_PROVIDER_ID) {
      const sub = entry.slice(separator + 1).trim();
      if (sub) zitadelSubs.add(sub);
    }
  }
  return { githubLogins, zitadelSubs };
}

/**
 * Whether the signed-in user is on the allowlist. A failed account lookup
 * throws (and the route answers 500) instead of reading as "not listed" or
 * "listed": an unobserved answer is neither.
 *
 * @param {{ user?: { id?: string, githubLogin?: string | null } } | null | undefined} session
 * @param {string | undefined} raw
 * @param {{ query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }} pool
 */
export async function isAllowlisted(session, raw, pool) {
  const user = session?.user;
  if (!user?.id) return false;
  const { githubLogins, zitadelSubs } = parseAllowlist(raw);
  if (user.githubLogin && githubLogins.has(String(user.githubLogin).toLowerCase())) return true;
  if (zitadelSubs.size === 0) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM "account" WHERE "userId" = $1 AND "providerId" = $2 AND "accountId" = ANY($3) LIMIT 1`,
    [user.id, ZITADEL_PROVIDER_ID, [...zitadelSubs]],
  );
  return rows.length > 0;
}
