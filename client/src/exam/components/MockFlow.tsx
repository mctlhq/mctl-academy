import { useState } from "react";
import type { ExamDataSource } from "../dataSource";
import type { Question } from "../types";
import type { ExamSessionState } from "../session";
import { answerQuestion, startSession, submitSession } from "../session";
import { shuffleOptions } from "../shuffleOptions";
import { clearSession, loadSession, saveSession } from "../persistence";
import { MockStartScreen } from "./MockStartScreen";
import { MockExamScreen } from "./MockExamScreen";
import { MockResultsScreen } from "./MockResultsScreen";

function restoreOrNull(): ExamSessionState | null {
  return loadSession();
}

export function MockFlow({ dataSource }: { dataSource: ExamDataSource }) {
  const [session, setSession] = useState<ExamSessionState | null>(() => restoreOrNull());

  function handleStart(questions: Question[], timeLimitMinutes: number) {
    const shuffled = questions.map((q) => shuffleOptions(q));
    const started = startSession(shuffled, timeLimitMinutes, Date.now());
    saveSession(started);
    setSession(started);
  }

  function handleAnswer(questionId: string, optionId: string) {
    if (!session) return;
    const updated = answerQuestion(session, questionId, optionId);
    saveSession(updated);
    setSession(updated);
  }

  function handleSubmit() {
    if (!session) return;
    const submitted = submitSession(session, Date.now());
    saveSession(submitted);
    setSession(submitted);
  }

  function handleStartOver() {
    clearSession();
    setSession(null);
  }

  if (!session) {
    return <MockStartScreen dataSource={dataSource} onStart={handleStart} />;
  }

  if (session.status === "in_progress") {
    return (
      <MockExamScreen
        session={session}
        onAnswer={handleAnswer}
        onSubmit={handleSubmit}
        onTimeExpired={handleSubmit}
      />
    );
  }

  return (
    <>
      <MockResultsScreen session={session} />
      <button type="button" onClick={handleStartOver}>
        Start a new mock exam
      </button>
    </>
  );
}
