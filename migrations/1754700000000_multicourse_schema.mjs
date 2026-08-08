/**
 * Migration 1754700000000: Multi-course database schema update.
 *
 * Adds `course_id` (varchar(64), NOT NULL, default 'agentic-ai-builder') to `attempts`
 * and `question_reports` tables. Creates composite index `attempts_user_course_question_idx`
 * to support efficient per-course learner progress lookups.
 */

export const shorthands = undefined;

export function up(pgm) {
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

export function down(pgm) {
  pgm.dropIndex("attempts", ["user_id", "course_id", "question_id"], {
    name: "attempts_user_course_question_idx",
  });

  pgm.dropColumn("attempts", "course_id");
  pgm.dropColumn("question_reports", "course_id");
}
