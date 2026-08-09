import { Hono } from "hono";
import { auth } from "../auth.mjs";
import { upsertQuestionVote, deleteQuestionVote, getQuestionVoteSummary } from "../db.mjs";
import { isKnownQuestionId } from "../questions.mjs";
import { requireSameOrigin } from "../middleware/csrf.mjs";

export const votesRouter = new Hono();

/**
 * Fully auth-gated, like /api/attempts — not /api/reports' anonymous design.
 * A vote is unambiguously tied to one learner (the UNIQUE (user_id,
 * question_id) constraint means a vote without a user_id is meaningless), so
 * there is no anonymous path to support here.
 */
async function requireUser(c) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

// PUT /api/votes/:questionId - Cast or change a vote on a question
votesRouter.put("/:questionId", requireSameOrigin, async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const questionId = c.req.param("questionId");
  if (!isKnownQuestionId(questionId)) {
    return c.json({ error: "Unknown question_id" }, 404);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const { value } = body || {};
  if (value !== 1 && value !== -1) {
    return c.json({ error: "value must be 1 or -1" }, 400);
  }

  await upsertQuestionVote({ userId: user.id, questionId, value });
  const summary = await getQuestionVoteSummary({ questionId, userId: user.id });

  return c.json({ success: true, score: summary.score, userValue: summary.userValue });
});

// DELETE /api/votes/:questionId - Remove the signed-in learner's vote, if any
votesRouter.delete("/:questionId", requireSameOrigin, async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const questionId = c.req.param("questionId");
  if (!isKnownQuestionId(questionId)) {
    return c.json({ error: "Unknown question_id" }, 404);
  }

  await deleteQuestionVote({ userId: user.id, questionId });
  const summary = await getQuestionVoteSummary({ questionId, userId: user.id });

  return c.json({ success: true, score: summary.score, userValue: summary.userValue });
});

// GET /api/votes/:questionId - The aggregate score and the signed-in learner's own vote
votesRouter.get("/:questionId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const questionId = c.req.param("questionId");
  if (!isKnownQuestionId(questionId)) {
    return c.json({ error: "Unknown question_id" }, 404);
  }

  const summary = await getQuestionVoteSummary({ questionId, userId: user.id });
  return c.json({ score: summary.score, userValue: summary.userValue });
});
