/**
 * A dedicated read-only Postgres role for a private, maintainer-only Grafana
 * dashboard (sign-ups, logins, attempts) — not a product feature, not
 * mentioned in PRIVACY.md/README.md, and never exposed to learners.
 *
 * Scoped to exactly "user", "session", attempts. Deliberately excludes
 * "account" (OAuth accessToken/refreshToken/idToken), "verification",
 * question_reports, and question_votes — this role must never be able to
 * read OAuth tokens even if a future Grafana panel author intends no harm.
 *
 * No PASSWORD clause: this migration runs in a public repo. The role starts
 * with LOGIN but no usable password (a passwordless role cannot authenticate
 * over a network connection), so it exists and is grant-scoped here, then a
 * password is set once out-of-band directly against the database and stored
 * in Vault for Grafana's datasource — the same secrets-never-in-git pattern
 * this project already uses for its own DATABASE_URL.
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
  pgm.sql(`GRANT SELECT ON "user", "session", attempts TO academy_readonly;`);
}

export function down(pgm) {
  pgm.sql(`REVOKE SELECT ON "user", "session", attempts FROM academy_readonly;`);
  pgm.sql(`REVOKE USAGE ON SCHEMA public FROM academy_readonly;`);
  pgm.sql(`
    DO $$
    BEGIN
      EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM academy_readonly', current_database());
    END $$;
  `);
  pgm.sql(`DROP ROLE IF EXISTS academy_readonly;`);
}
