import { useState } from "react";
import { usePracticeSession, type BundleQuestion } from "./usePracticeSession";
import { renderInlineMarkdown } from "./renderInlineMarkdown";
import { ReportModal } from "../components/ReportModal";
import "./PracticeScreen.css";

interface PracticeScreenProps {
  /** Override the bundle read at build time — used by tests. */
  bundle?: readonly BundleQuestion[];
}

export function PracticeScreen({ bundle }: PracticeScreenProps) {
  const { current, index, total, revealed, score, attempted, selectOption, next } =
    usePracticeSession(bundle);
  const [isReporting, setIsReporting] = useState(false);

  if (total === 0) {
    return (
      <main className="practice practice-empty">
        <h1>Practice</h1>
        <p>
          There are no published questions yet. Check back once the content bank has questions
          with <code>status: published</code>.
        </p>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="practice practice-summary">
        <h1>Session complete</h1>
        <p className="score">
          {score} / {attempted} correct on first try
        </p>
        <p className="meta">{total} questions attempted this session.</p>
      </main>
    );
  }

  return (
    <main className="practice">
      <div className="practice-header">
        <p className="progress">
          Question {index + 1} of {total}
        </p>
        <button
          type="button"
          className="btn-report"
          onClick={() => setIsReporting(true)}
          title="Report an issue with this question"
        >
          Report issue
        </button>
      </div>

      {/* Restricted inline Markdown only: escaped text plus backtick code
          spans, matching build-preview.mjs's contract for the same field. */}
      <h1
        className="stem"
        dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(current.stem) }}
      />
      <ul className="options">
        {current.options.map((option) => {
          const isRevealed = revealed.has(option.id);
          return (
            <li key={option.id} className={isRevealed ? (option.correct ? "correct" : "incorrect") : ""}>
              <button type="button" onClick={() => selectOption(option.id)}>
                <span
                  className="option-text"
                  dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(option.text) }}
                />
              </button>
              {isRevealed && (
                <div className="feedback">
                  <p className="verdict">{option.correct ? "Correct" : "Incorrect"}</p>
                  <p
                    className="explanation"
                    dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(option.explanation) }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="next" onClick={next}>
        {index + 1 === total ? "Finish" : "Next question"}
      </button>

      {isReporting && (
        <ReportModal
          questionId={current.id}
          onClose={() => setIsReporting(false)}
        />
      )}
    </main>
  );
}

