/**
 * Migration 1754800000000: drop per-attempt course_id.
 *
 * 1754700000000 added `course_id` to `attempts` and `question_reports` so a
 * learner's course could be recorded alongside each attempt. That was the
 * wrong place for it: which course a question belongs to is canonical content
 * metadata (`content/questions/*.yaml` -> `course_id`), derivable from the
 * question id the row already stores. Duplicating it here made a content fact
 * into personal learner data, and left two records of it to reconcile whenever
 * content moved between courses.
 *
 * Per-course progress is now derived client-side by intersecting attempts with
 * the active course's question ids, so nothing reads these columns.
 *
 * Forward-only rather than editing 1754700000000 in place: that migration has
 * already been merged, and rewriting applied history is worse than adding an
 * inverse. `down` restores the previous schema exactly.
 */

export const shorthands = undefined;

export function up(pgm) {
  pgm.dropIndex("attempts", ["user_id", "course_id", "question_id"], {
    name: "attempts_user_course_question_idx",
  });

  pgm.dropColumn("attempts", "course_id");
  pgm.dropColumn("question_reports", "course_id");
}

export function down(pgm) {
  pgm.addColumn("attempts", {
    course_id: {
      type: "varchar(64)",
      notNull: true,
      default: "agentic-ai-builder",
    },
  });

  pgm.createIndex("attempts", ["user_id", "course_id", "question_id"], {
    name: "attempts_user_course_question_idx",
  });

  pgm.addColumn("question_reports", {
    course_id: {
      type: "varchar(64)",
      notNull: true,
      default: "agentic-ai-builder",
    },
  });
}
