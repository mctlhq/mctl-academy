/**
 * A dedicated read-only Postgres role for a private, maintainer-only Grafana
 * dashboard (sign-ups, logins, attempts) — not a product feature, not
 * mentioned in PRIVACY.md/README.md, and never exposed to learners.
 *
 * Scoped to exactly "user", "session", attempts — and, on "user"/"session",
 * to a single column each ("createdAt"), not the whole table. Column-level
 * grants because "session" holds the live authentication bearer token
 * (session.token — the literal credential behind the mctl_session cookie)
 * and "user" holds email/name/image/githubLogin; a table-wide GRANT would
 * let anything with query access to this role (e.g. Grafana's Explore, not
 * just this one dashboard's fixed panels) read those out directly. The
 * dashboard only ever needs "createdAt" from either table. Deliberately
 * excludes "account" (OAuth accessToken/refreshToken/idToken), "verification",
 * question_reports, and question_votes entirely — this role must never be
 * able to read OAuth tokens even if a future Grafana panel author intends no
 * harm.
 *
 * No PASSWORD clause: this migration runs in a public repo. The role starts
 * with LOGIN but no usable password (a passwordless role cannot authenticate
 * over a network connection). CNPG's managed.roles (platform-gitops) owns
 * setting/rotating the actual password from Vault — see
 * platform-gitops/infra-components/data/cnpg/shared/cluster.yaml.
 */

export const shorthands = undefined;

export function up(pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'academy_readonly') THEN
        CREATE ROLE academy_readonly LOGIN;
      END IF;
    END $$;
  `);

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
  pgm.sql(`GRANT SELECT ON attempts TO academy_readonly;`);
}

export function down(pgm) {
  pgm.sql(`REVOKE SELECT ON attempts FROM academy_readonly;`);
  pgm.sql(`REVOKE SELECT ("createdAt") ON "session" FROM academy_readonly;`);
  pgm.sql(`REVOKE SELECT ("createdAt") ON "user" FROM academy_readonly;`);
  pgm.sql(`REVOKE USAGE ON SCHEMA public FROM academy_readonly;`);
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM academy_readonly', current_database());
    END $$;
  `);
  pgm.sql(`DROP ROLE IF EXISTS academy_readonly;`);
}
