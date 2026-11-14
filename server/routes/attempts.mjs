import { Hono } from "hono";
import { auth } from "../auth.mjs";
import { recordUserAttempt, getUserAttempts, deleteUserAttempts } from "../db.mjs";
import { requireSameOrigin } from "../middleware/csrf.mjs";
import { gradeAttempt } from "../questions.mjs";

export const attemptsRouter = new Hono();

/**
 * An attempt is stored against its questionId and nothing more.
 *
 * Course membership is deliberately not part of this payload or this table:
 * it is canonical content metadata (questionId -> question.course_id), so the
 * client derives per-course progress by intersecting attempts with the active
 * course's question ids. Storing it here would duplicate content as personal
 * learner data, and leave two records of the same fact to reconcile whenever
 * content moves.
 */
async function requireUser(c) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

function serializeAttempt(attempt) {
  return {
    questionId: attempt.questionId ?? attempt.question_id,
    domain: attempt.domain,
    correct: attempt.correct,
    attemptedAt: attempt.attemptedAt ?? attempt.attempted_at,
  };
}

// POST /api/attempts - Record a practice attempt for the signed-in learner
attemptsRouter.post("/", requireSameOrigin, async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  // The client sends only what the learner did: the question and the stable
  // option id chosen (null = a Mock exam question left unanswered). Whether
  // that was correct, and which domain it counts toward, is decided here from
  // the answer key (issue #208). A `correct` or `domain` field sent by a client
  // is ignored, never stored -- otherwise the accuracy aggregate is forgeable.
  const { questionId, optionId } = body || {};

  if (!questionId || typeof questionId !== "string") {
    return c.json({ error: "questionId is required" }, 400);
  }
  if (optionId !== null && typeof optionId !== "string") {
    return c.json({ error: "optionId must be a string, or null for an unanswered question" }, 400);
  }

  const graded = gradeAttempt(questionId, optionId);
  if (!graded.ok) {
    if (graded.reason === "unknown_question") return c.json({ error: "Unknown questionId" }, 400);
    if (graded.reason === "unknown_option") return c.json({ error: "Unknown optionId" }, 400);
    // The answer key could not be read: refuse rather than store a guess.
    return c.json({ error: "Attempt cannot be graded right now" }, 503);
  }
  const { domain, correct } = graded;

  const stored = await recordUserAttempt({ userId: user.id, questionId, domain, correct });

  return c.json({ success: true, attempt: serializeAttempt(stored) }, 201);
});

// GET /api/attempts - Latest attempt per question for the signed-in learner
attemptsRouter.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const attempts = await getUserAttempts(user.id);
  return c.json({ attempts: attempts.map(serializeAttempt) });
});

// DELETE /api/attempts - Erase every attempt for the signed-in learner
// ("Clear history"). Local storage is cleared independently of this call —
// see client/src/services/progressStore.ts — so this is what actually makes
// the deletion permanent rather than something the next sync silently undoes.
attemptsRouter.delete("/", requireSameOrigin, async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  await deleteUserAttempts(user.id);

  return c.json({ success: true });
});
