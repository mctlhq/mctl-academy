import { beforeEach, describe, expect, it } from "vitest";
import { answerQuestion, remainingMs, scoreSession, startSession, submitSession, tick } from "../session";
import { clearSession, loadSession, saveSession } from "../persistence";
import type { Question } from "../types";

function makeQuestions(): Question[] {
  return [
    {
      id: "q-1",
      domain: "domain-1",
      objective: "domain-1/obj",
      stem: "Stem 1",
      options: [
        { id: "a", text: "A", correct: true, explanation: "exp a" },
        { id: "b", text: "B", correct: false, explanation: "exp b" },
        { id: "c", text: "C", correct: false, explanation: "exp c" },
        { id: "d", text: "D", correct: false, explanation: "exp d" },
      ],
    },
  ];
}

describe("ExamSession transitions", () => {
  it("T4: tick() auto-submits once remainingMs reaches zero, without learner action", () => {
    const now = 1_000_000;
    const session = startSession(makeQuestions(), 60, now);

    const stillRunning = tick(session, now + 59 * 60_000);
    expect(stillRunning.status).toBe("in_progress");

    const expired = tick(session, now + 60 * 60_000 + 1);
    expect(expired.status).toBe("submitted");
    expect(expired.submittedAt).toBe(now + 60 * 60_000 + 1);
  });

  it("records and overwrites an answer while in progress", () => {
    const session = startSession(makeQuestions(), 60, 0);
    const answered = answerQuestion(session, "q-1", "a");
    expect(answered.answers["q-1"]).toBe("a");
    const changed = answerQuestion(answered, "q-1", "b");
    expect(changed.answers["q-1"]).toBe("b");
  });

  it("ignores answer attempts once submitted", () => {
    const submitted = submitSession(startSession(makeQuestions(), 60, 0), 1000);
    const attempted = answerQuestion(submitted, "q-1", "a");
    expect(attempted.answers["q-1"]).toBeUndefined();
  });

  it("computes score against recorded answers", () => {
    const answered = answerQuestion(startSession(makeQuestions(), 60, 0), "q-1", "a");
    const score = scoreSession(submitSession(answered, 1000));
    expect(score.correctCount).toBe(1);
    expect(score.totalCount).toBe(1);
    expect(score.perQuestion[0]).toEqual({
      questionId: "q-1",
      selectedOptionId: "a",
      correctOptionId: "a",
      isCorrect: true,
    });
  });
});

const COURSE_ID = "agentic-ai-builder";

describe("session persistence", () => {
  beforeEach(() => {
    clearSession(COURSE_ID);
  });

  it("T5: reload restores prior answers and recomputes remainingMs from the persisted expiresAt, not a reset clock", () => {
    const startedAt = 1_000_000;
    const session = answerQuestion(startSession(makeQuestions(), 60, startedAt), "q-1", "a");
    saveSession(COURSE_ID, session);

    const reloadTime = startedAt + 10 * 60_000; // 10 minutes later
    const restored = loadSession(COURSE_ID);
    expect(restored).not.toBeNull();
    expect(restored?.answers["q-1"]).toBe("a");
    // 60 minutes total, 10 elapsed -> 50 remaining, computed from the stored
    // expiresAt -- NOT a fresh 60 minutes from reloadTime.
    expect(remainingMs(restored!, reloadTime)).toBe(50 * 60_000);
  });

  it("returns null when nothing was saved", () => {
    expect(loadSession(COURSE_ID)).toBeNull();
  });
});
