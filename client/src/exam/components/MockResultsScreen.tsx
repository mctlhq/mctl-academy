import type { ExamSessionState } from "../session";
import { scoreSession } from "../session";
import { RestrictedMarkdown } from "./RestrictedMarkdown";

export function MockResultsScreen({ session }: { session: ExamSessionState }) {
  const score = scoreSession(session);

  return (
    <section className="mock-results" data-testid="mock-results">
      <h1>Results</h1>
      <p className="mock-results-score" data-testid="score">
        {score.correctCount} / {score.totalCount} correct
      </p>

      <ol className="mock-results-list">
        {session.questions.map((question) => {
          const selectedOptionId = session.answers[question.id];
          return (
            <li key={question.id} className="mock-results-question">
              <p className="mock-results-stem">
                <RestrictedMarkdown text={question.stem} />
              </p>
              <ul className="mock-results-options">
                {question.options.map((option) => (
                  <li
                    key={option.id}
                    className={
                      "mock-results-option" +
                      (option.correct ? " correct" : "") +
                      (option.id === selectedOptionId ? " selected" : "")
                    }
                  >
                    <p>
                      <RestrictedMarkdown text={option.text} />
                      {option.correct && <span className="tag"> Correct answer</span>}
                      {option.id === selectedOptionId && !option.correct && (
                        <span className="tag"> Your answer</span>
                      )}
                      {option.id === selectedOptionId && option.correct && (
                        <span className="tag"> Your answer</span>
                      )}
                    </p>
                    <p className="mock-results-explanation">
                      <RestrictedMarkdown text={option.explanation} />
                    </p>
                  </li>
                ))}
              </ul>
              {selectedOptionId === undefined && <p className="mock-results-unanswered">Not answered.</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
