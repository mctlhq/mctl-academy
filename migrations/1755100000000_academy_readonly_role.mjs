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
 * GRANT CONNECT ON DATABASE / GRANT USAGE ON SCHEMA below need database
 * and schema privileges, a different class from the table ownership that
 * covers the GRANTs further down — worth calling out separately because it
 * is exactly the kind of thing CI can't catch: both CI jobs that run this
 * migration connect as the Postgres superuser, not as labs-mctl-academy,
 * so a privilege gap here would pass CI and only surface in production.
 * Verified by hand instead: platform-gitops's Database CR
 * (infra-components/data/cnpg/shared/databases.yaml) sets
 * `owner: "labs-mctl-academy"`, and on Postgres 15+ (this cluster runs 17)
 * a database's `public` schema is owned by the pg_database_owner
 * pseudo-role, which the database's actual owner is always implicitly a
 * member of — confirmed against a real Postgres 17 instance with the same
 * shape (a non-superuser role owning its own database) that both GRANTs
 * succeed for that role, not just for a table it owns.
 *
 * Grants are COLUMN-level, not table-level, on "user"/"session" — "session"
 * holds the live authentication bearer token (session.token — the literal
 * credential behind the mctl_session cookie) and "user" holds
 * email/name/image/githubLogin; a table-wide GRANT would let anything with
 * query access to this role (e.g. Grafana's Explore, not just this one
 * dashboard's fixed panels) read those out directly. The dashboard only
 * ever needs "createdAt" from either table.
 *
 * attempts is column-scoped too, and deliberately excludes user_id (as well
 * as id and question_id): domain/correct/attempted_at alone are pure
 * aggregates with no way to tie a row back to a specific learner, but
 * domain+correct+attempted_at *plus* user_id — even though user_id is an
 * opaque better-auth id, not a name or email — would let anything querying
 * this role directly (not just through the dashboard's fixed
 * count()/date_trunc() panels) reconstruct a specific pseudonymous
 * learner's full per-question performance timeline. That is exactly the
 * kind of per-individual observability PRIVACY.md promises the product
 * doesn't do, even internally, so the "Unique active users" metric
 * (count(DISTINCT user_id)) simply isn't offered here — see the dashboard's
 * About panel for the corresponding UI-side removal. Deliberately excludes
 * "account" (OAuth accessToken/refreshToken/idToken), "verification",
 * question_reports, and question_votes entirely — this role must never be
 * able to read OAuth tokens even if a future Grafana panel author intends
 * no harm.
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
  pgm.sql(`GRANT SELECT (domain, correct, attempted_at) ON attempts TO academy_readonly;`);
}

export function down(pgm) {
  pgm.sql(`REVOKE SELECT (domain, correct, attempted_at) ON attempts FROM academy_readonly;`);
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
