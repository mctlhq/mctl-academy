/**
 * Baseline: the schema exactly as it existed under the old
 * CREATE TABLE IF NOT EXISTS boot-time block in server/db.mjs, moved here so
 * schema changes are versioned instead of applied ad hoc on every start.
 *
 * Superseded tables (`users`, `sessions`) are dropped in a later migration
 * once auth moves to better-auth's own schema — kept here, unedited, so this
 * migration is a faithful record of what was actually running in production.
 */

export const shorthands = undefined;

export function up(pgm) {
  // No pgcrypto extension: gen_random_uuid() has been a core built-in
  // function since PostgreSQL 13 (verified against a real PG13 container —
  // no extension installed, function works). The old boot-time DDL never
  // created this extension either, and doing it here would need CREATE
  // privilege the app's role on the shared CNPG cluster may not have —
  // exactly the kind of migration failure that's now fatal to production
  // boot.
  pgm.createTable(
    "users",
    {
      id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
      github_id: { type: "bigint", notNull: true, unique: true },
      github_login: { type: "varchar(255)", notNull: true },
      avatar_url: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { ifNotExists: true }
  );

  pgm.createTable(
    "sessions",
    {
      id: { type: "varchar(255)", primaryKey: true },
      user_id: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "CASCADE",
      },
      expires_at: { type: "timestamptz", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { ifNotExists: true }
  );

  pgm.createTable(
    "attempts",
    {
      id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
      user_id: {
        type: "uuid",
        references: "users",
        onDelete: "CASCADE",
      },
      question_id: { type: "varchar(255)", notNull: true },
      domain: { type: "varchar(255)", notNull: true },
      correct: { type: "boolean", notNull: true },
      attempted_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { ifNotExists: true }
  );

  pgm.createTable(
    "question_reports",
    {
      id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
      question_id: { type: "varchar(255)", notNull: true },
      reason: { type: "varchar(64)", notNull: true },
      comment: { type: "text" },
      reporter_user_id: {
        type: "uuid",
        references: "users",
        onDelete: "SET NULL",
      },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { ifNotExists: true }
  );

  pgm.createIndex("question_reports", "question_id", {
    name: "question_reports_question_id_idx",
    ifNotExists: true,
  });
}

export function down(pgm) {
  pgm.dropTable("question_reports");
  pgm.dropTable("attempts");
  pgm.dropTable("sessions");
  pgm.dropTable("users");
}
