/**
 * Grants for a dedicated read-only Postgres role backing a private,
 * maintainer-only Grafana dashboard (sign-ups, logins, attempts) — not a
 * product feature, not mentioned in PRIVACY.md/README.md, and never
 * exposed to learners.
 *
 * This migration does NOT create the role. It used to (CREATE ROLE ... IF
 * NOT EXISTS), but that requires CREATEROLE, which this app's own DB role
 * (labs-mctl-academy) does not have and never will — verified against a
 * real Postgres instance: a plain LOGIN role with no CREATEROLE gets
 * "permission denied to create role" attempting exactly that statement.
 * Role creation belongs solely to CNPG's managed.roles in platform-gitops
 * (infra-components/data/cnpg/shared/cluster.yaml), which runs as a
 * superuser-equivalent connection outside this app entirely.
 *
 * Deploy ordering this implies: platform-gitops's academy_readonly
 * managed.roles entry must sync (and CNPG must reconcile it) BEFORE this
 * migration runs. If it runs first, every GRANT below fails cleanly with
 * "role academy_readonly does not exist" (verified) — a clear, actionable
 * error, and safely retryable: node-pg-migrate wraps this in one
 * transaction, so a failed run leaves no partial state and re-running this
 * app's migration after the role exists succeeds normally.
 *
 * Grants are COLUMN-level, not table-level, on "user"/"session" — "session"
 * holds the live authentication bearer token (session.token — the literal
 * credential behind the mctl_session cookie) and "user" holds
 * email/name/image/githubLogin; a table-wide GRANT would let anything with
 * query access to this role (e.g. Grafana's Explore, not just this one
 * dashboard's fixed panels) read those out directly. The dashboard only
 * ever needs "createdAt" from either table. attempts is also column-scoped
 * — (user_id, domain, correct, attempted_at), the only four the dashboard's
 * SQL ever references — rather than granted whole: even with no OAuth
 * tokens or PII, unrestricted attempts access would hand out every
 * learner's full per-question answer history (id + question_id joined to
 * user_id), which is more than "aggregates for a usage dashboard" needs and
 * more than this role should be able to hand to anything querying it
 * directly (e.g. Grafana Explore) rather than through the dashboard's fixed
 * panels. Deliberately excludes "account" (OAuth
 * accessToken/refreshToken/idToken), "verification", question_reports, and
 * question_votes entirely — this role must never be able to read OAuth
 * tokens even if a future Grafana panel author intends no harm.
 *
 * GRANT itself needs no CREATEROLE — only ownership of (or GRANT OPTION on)
 * the table, which labs-mctl-academy already has as the owner of every
 * table in this database — so these statements work regardless of this
 * app's own role's privilege level, unlike the CREATE ROLE this migration
 * used to attempt.
 */

export const shorthands = undefined;

export function up(pgm) {
  // GRANT CONNECT ON DATABASE takes an identifier, not an expression, so the
  // current database name is spliced in via format() rather than assumed.
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO academy_readonly', current_database());
    END $$;
  `);

  pgm.sql(`GRANT USAGE ON SCHEMA public TO academy_readonly;`);
  pgm.sql(`GRANT SELECT ("createdAt") ON "user" TO academy_readonly;`);
  pgm.sql(`GRANT SELECT ("createdAt") ON "session" TO academy_readonly;`);
  pgm.sql(`GRANT SELECT (user_id, domain, correct, attempted_at) ON attempts TO academy_readonly;`);
}

export function down(pgm) {
  pgm.sql(`REVOKE SELECT (user_id, domain, correct, attempted_at) ON attempts FROM academy_readonly;`);
  pgm.sql(`REVOKE SELECT ("createdAt") ON "session" FROM academy_readonly;`);
  pgm.sql(`REVOKE SELECT ("createdAt") ON "user" FROM academy_readonly;`);
  pgm.sql(`REVOKE USAGE ON SCHEMA public FROM academy_readonly;`);
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM academy_readonly', current_database());
    END $$;
  `);
  // No DROP ROLE: CNPG's managed.roles (platform-gitops) owns this role's
  // lifecycle now, with ensure: present — dropping it here would just have
  // CNPG recreate it on its next reconcile, so this app's migration
  // shouldn't pretend it can remove it.
}
