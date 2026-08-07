import { useEffect, useState } from "react";
import type { ExamSessionState } from "../session";
import { remainingMs, unansweredCount } from "../session";
import { RestrictedMarkdown } from "./RestrictedMarkdown";
import { formatRemaining } from "./formatTime";

/**
 * The in-progress exam screen. Deliberately renders only `id`/`text` from
 * each option -- never `correct` or `explanation` -- so deferred feedback
 * cannot leak through this component regardless of what the session object
 * carries (see requirements.md's "SHALL NOT reveal" acceptance criterion).
 */
export function MockExamScreen({
  session,
  onAnswer,
  onSubmit,
  onTimeExpired,
}: {
  session: ExamSessionState;
  onAnswer: (questionId: string, optionId: string) => void;
  onSubmit: () => void;
  onTimeExpired: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  const remaining = remainingMs(session, now);

  useEffect(() => {
    if (session.status === "in_progress" && remaining <= 0) {
      onTimeExpired();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, session.status]);

  const question = session.questions[currentIndex];
  const selectedOptionId = session.answers[question.id];
  const unanswered = unansweredCount(session);

  function goSubmit() {
    if (unanswered > 0 && !confirmingSubmit) {
      setConfirmingSubmit(true);
      return;
    }
    onSubmit();
  }

  return (
    <section className="mock-exam" data-testid="mock-exam">
      <header className="mock-exam-header">
        <span className="mock-exam-timer" data-testid="timer" aria-live="polite">
          {formatRemaining(remaining)}
        </span>
        <span>
          Question {currentIndex + 1} of {session.questions.length}
        </span>
      </header>

      <nav className="mock-exam-nav" aria-label="Question navigator">
        {session.questions.map((q, index) => {
          const answered = session.answers[q.id] !== undefined;
          return (
            <button
              key={q.id}
              type="button"
              className={
                "mock-exam-nav-item" +
                (answered ? " answered" : " unanswered") +
                (index === currentIndex ? " current" : "")
              }
              aria-current={index === currentIndex}
              aria-label={`Question ${index + 1}${answered ? ", answered" : ", unanswered"}`}
              onClick={() => setCurrentIndex(index)}
            >
              {index + 1}
            </button>
          );
        })}
      </nav>

      <article className="mock-exam-question">
        <p className="mock-exam-stem">
          <RestrictedMarkdown text={question.stem} />
        </p>
        <fieldset>
          <legend className="sr-only">Options</legend>
          {question.options.map((option) => (
            <label key={option.id} className="mock-exam-option">
              <input
                type="radio"
                name={`question-${question.id}`}
                value={option.id}
                checked={selectedOptionId === option.id}
                onChange={() => onAnswer(question.id, option.id)}
              />
              <RestrictedMarkdown text={option.text} />
            </label>
          ))}
        </fieldset>
      </article>

      <footer className="mock-exam-footer">
        <button
          type="button"
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => setCurrentIndex((i) => Math.min(session.questions.length - 1, i + 1))}
          disabled={currentIndex === session.questions.length - 1}
        >
          Next
        </button>
        <button type="button" onClick={goSubmit}>
          Submit exam
        </button>
      </footer>

      {confirmingSubmit && (
        <div className="mock-exam-confirm" role="alertdialog" data-testid="submit-confirm">
          <p>
            {unanswered} question{unanswered === 1 ? " is" : "s are"} still unanswered. Submit
            anyway?
          </p>
          <button type="button" onClick={onSubmit}>
            Submit anyway
          </button>
          <button type="button" onClick={() => setConfirmingSubmit(false)}>
            Keep going
          </button>
        </div>
      )}
    </section>
  );
}
