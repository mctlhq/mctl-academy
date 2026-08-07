import type { Question } from "./types";

export type ExamStatus = "not_started" | "in_progress" | "submitted";

export interface ExamSessionState {
  id: string;
  status: ExamStatus;
  /** The 30 selected questions, each with options already shuffled for this session, in navigation order. */
  questions: Question[];
  /** questionId -> selected optionId. Absent/undefined means unanswered. */
  answers: Record<string, string | undefined>;
  startedAt: number | null;
  expiresAt: number | null;
  submittedAt: number | null;
}

export function createSessionId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `sess-${rand()}${rand()}`;
}

/** Starts a new in-progress session. `now` is the caller-supplied wall-clock time in epoch ms. */
export function startSession(questions: Question[], timeLimitMinutes: number, now: number): ExamSessionState {
  return {
    id: createSessionId(),
    status: "in_progress",
    questions,
    answers: {},
    startedAt: now,
    expiresAt: now + timeLimitMinutes * 60_000,
    submittedAt: null,
  };
}

/** Records/overwrites an answer. No-op once the session is no longer in_progress. */
export function answerQuestion(
  session: ExamSessionState,
  questionId: string,
  optionId: string,
): ExamSessionState {
  if (session.status !== "in_progress") return session;
  return { ...session, answers: { ...session.answers, [questionId]: optionId } };
}

/** Milliseconds remaining as of `now`, clamped to zero. */
export function remainingMs(session: ExamSessionState, now: number): number {
  if (session.expiresAt === null) return 0;
  return Math.max(0, session.expiresAt - now);
}

/** Stops the timer and locks answers. No-op if not currently in_progress. */
export function submitSession(session: ExamSessionState, now: number): ExamSessionState {
  if (session.status !== "in_progress") return session;
  return { ...session, status: "submitted", submittedAt: now };
}

/**
 * Advances the session for wall-clock time `now`: auto-submits once
 * remainingMs reaches zero, with no learner action required. Pure and
 * DOM-free so the auto-submit rule is unit-testable directly; a UI timer
 * hook calls this on an interval.
 */
export function tick(session: ExamSessionState, now: number): ExamSessionState {
  if (session.status === "in_progress" && remainingMs(session, now) <= 0) {
    return submitSession(session, now);
  }
  return session;
}

export function unansweredCount(session: ExamSessionState): number {
  return session.questions.filter((q) => session.answers[q.id] === undefined).length;
}

export interface ScoredQuestion {
  questionId: string;
  selectedOptionId: string | undefined;
  correctOptionId: string;
  isCorrect: boolean;
}

export interface ScoreResult {
  correctCount: number;
  totalCount: number;
  perQuestion: ScoredQuestion[];
}

/** Computes the score. Meaningful once status is "submitted", but callable at any point. */
export function scoreSession(session: ExamSessionState): ScoreResult {
  const perQuestion = session.questions.map((q): ScoredQuestion => {
    const correctOption = q.options.find((o) => o.correct);
    const selectedOptionId = session.answers[q.id];
    return {
      questionId: q.id,
      selectedOptionId,
      correctOptionId: correctOption ? correctOption.id : "",
      isCorrect: Boolean(correctOption) && selectedOptionId === correctOption?.id,
    };
  });
  return {
    correctCount: perQuestion.filter((p) => p.isCorrect).length,
    totalCount: perQuestion.length,
    perQuestion,
  };
}
