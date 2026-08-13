/**
 * A learner's +1/-1 vote on a question. One row per (user_id, question_id) —
 * "no vote" is the absence of a row, not a row with value 0, so removing a
 * vote is a DELETE, not an UPDATE. The UNIQUE constraint on (user_id,
 * question_id) is what makes `upsertQuestionVote`'s
 * `ON CONFLICT (user_id, question_id) DO UPDATE` meaningful.
 *
 * Like `attempts`/`question_reports`, `question_id` has no FK: questions live
 * in content/ YAML, not the database — see server/questions.mjs's
 * isKnownQuestionId() for the API-layer check instead. No `course_id` either,
 * for the same reason those tables dropped theirs in
 * 1754800000000_drop_attempt_course_id.mjs: course is derivable from
 * question_id/content, not learner-scoped data worth duplicating here.
 *
 * user_id references "user"(id) directly as text from the start — this table
 * postdates the better-auth cutover (1754607600000), so it never needs the
 * uuid-to-text remap attempts/question_reports went through.
 */

export const shorthands = undefined;

export function up(pgm) {
  pgm.createTable(
    "question_votes",
    {
      id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
      user_id: {
        type: "text",
        notNull: true,
        references: '"user"',
        onDelete: "CASCADE",
      },
      question_id: { type: "varchar(255)", notNull: true },
      value: { type: "smallint", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { ifNotExists: true },
  );

  pgm.addConstraint("question_votes", "question_votes_value_check", {
    check: "value IN (-1, 1)",
  });

  pgm.addConstraint("question_votes", "question_votes_user_id_question_id_key", {
    unique: ["user_id", "question_id"],
  });

  // Serves the aggregate-score read path (getQuestionVoteSummary), which
  // scans by question_id across every voter, not just one user.
  pgm.createIndex("question_votes", "question_id", {
    name: "question_votes_question_id_idx",
    ifNotExists: true,
  });
}

export function down(pgm) {
  pgm.dropTable("question_votes");
}
