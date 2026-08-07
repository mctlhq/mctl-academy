/**
 * Single source of truth for the Postgres SSL config, shared by server/db.mjs
 * and scripts/migrate.mjs.
 *
 * This exists because of a bug that already happened once: db.mjs's pool and
 * its migration connection each built their own ssl option, and the two
 * silently disagreed — migrations succeeded while every later query on the
 * pool failed, because only one side was requesting SSL. Hand-copying the
 * same object into scripts/migrate.mjs (a separate process, not importable
 * from db.mjs's module-private state) would reintroduce exactly that class
 * of bug the moment the two files drift, just between the boot path and the
 * CI-only migration script instead of within a single process.
 *
 * rejectUnauthorized: false matches the connection pattern already used by
 * mctl-loyalty and mctl-pairdesk against the same CNPG cluster; there is no
 * CA distribution in place yet to verify the server certificate. That gap is
 * a platform-wide concern, not something to solve differently in one service.
 */
export function dbSslConfig(isProduction = process.env.NODE_ENV === "production") {
  return isProduction ? { rejectUnauthorized: false } : false;
}
