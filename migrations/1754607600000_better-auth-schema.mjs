/**
 * Replaces the hand-rolled `users`/`sessions` tables with better-auth's own
 * schema (`user`, `session`, `account`, `verification`), generated via
 * `bunx @better-auth/cli generate` against server/auth.mjs and reviewed here
 * rather than applied live — see PR3's migration-ownership note.
 *
 * This is a hard cutover, not a data migration: PR1 confirmed the `users`
 * table has zero rows in production (GitHub OAuth has never been configured
 * there), so there is nothing to backfill. `attempts.user_id` and
 * `question_reports.reporter_user_id` are repointed from `users.id` (uuid) to
 * `"user".id` (text — better-auth's generateId(), not a uuid) with no data
 * loss since every existing row's FK column is NULL (anonymous attempts are
 * allowed; no user ever signed in to attach one).
 */

export const shorthands = undefined;

export function up(pgm) {
  pgm.dropTable("sessions");

  pgm.dropConstraint("attempts", "attempts_user_id_fkey", { ifExists: true });
  pgm.alterColumn("attempts", "user_id", { type: "text" });

  pgm.dropConstraint("question_reports", "question_reports_reporter_user_id_fkey", { ifExists: true });
  pgm.alterColumn("question_reports", "reporter_user_id", { type: "text" });

  pgm.dropTable("users");

  pgm.sql(`
    create table "user" (
      "id" text not null primary key,
      "name" text not null,
      "email" text not null unique,
      "emailVerified" boolean not null,
      "image" text,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz default CURRENT_TIMESTAMP not null,
      "githubLogin" text
    );
  `);

  pgm.sql(`
    create table "session" (
      "id" text not null primary key,
      "expiresAt" timestamptz not null,
      "token" text not null unique,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz not null,
      "ipAddress" text,
      "userAgent" text,
      "userId" text not null references "user" ("id") on delete cascade
    );
  `);

  pgm.sql(`
    create table "account" (
      "id" text not null primary key,
      "accountId" text not null,
      "providerId" text not null,
      "userId" text not null references "user" ("id") on delete cascade,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamptz,
      "refreshTokenExpiresAt" timestamptz,
      "scope" text,
      "password" text,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz not null
    );
  `);

  pgm.sql(`
    create table "verification" (
      "id" text not null primary key,
      "identifier" text not null,
      "value" text not null,
      "expiresAt" timestamptz not null,
      "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
      "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
    );
  `);

  pgm.createIndex("session", "userId", { name: "session_userId_idx" });
  pgm.createIndex("account", "userId", { name: "account_userId_idx" });
  pgm.createIndex("verification", "identifier", { name: "verification_identifier_idx" });

  pgm.addConstraint("attempts", "attempts_user_id_fkey", {
    foreignKeys: {
      columns: "user_id",
      references: '"user"(id)',
      onDelete: "CASCADE",
    },
  });
  pgm.addConstraint("question_reports", "question_reports_reporter_user_id_fkey", {
    foreignKeys: {
      columns: "reporter_user_id",
      references: '"user"(id)',
      onDelete: "SET NULL",
    },
  });
}

export function down(pgm) {
  pgm.dropConstraint("attempts", "attempts_user_id_fkey", { ifExists: true });
  pgm.dropConstraint("question_reports", "question_reports_reporter_user_id_fkey", { ifExists: true });

  pgm.dropTable("verification");
  pgm.dropTable("account");
  pgm.dropTable("session");
  pgm.dropTable("user");

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

  pgm.alterColumn("attempts", "user_id", { type: "uuid", using: "user_id::uuid" });
  pgm.addConstraint("attempts", "attempts_user_id_fkey", {
    foreignKeys: {
      columns: "user_id",
      references: "users",
      onDelete: "CASCADE",
    },
  });

  pgm.alterColumn("question_reports", "reporter_user_id", { type: "uuid", using: "reporter_user_id::uuid" });
  pgm.addConstraint("question_reports", "question_reports_reporter_user_id_fkey", {
    foreignKeys: {
      columns: "reporter_user_id",
      references: "users",
      onDelete: "SET NULL",
    },
  });
}
