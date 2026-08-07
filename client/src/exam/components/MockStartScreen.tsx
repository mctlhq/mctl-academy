import { useEffect, useState } from "react";
import type { ExamDataSource } from "../dataSource";
import type { MockConfig, Question } from "../types";
import { selectMockQuestions, type SelectMockResult } from "../selectMockQuestions";

interface LoadedState {
  config: MockConfig;
  bankSize: number;
  selection: SelectMockResult;
}

export function MockStartScreen({
  dataSource,
  onStart,
}: {
  dataSource: ExamDataSource;
  onStart: (questions: Question[], timeLimitMinutes: number) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [config, questions, bankSize] = await Promise.all([
          dataSource.getMockConfig(),
          dataSource.getQuestions(),
          dataSource.getBankSize(),
        ]);
        if (cancelled) return;
        setLoaded({ config, bankSize, selection: selectMockQuestions(questions, config) });
      } catch {
        if (!cancelled) setError("Could not load the question bank.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [dataSource]);

  if (error) {
    return (
      <section className="mock-start" data-testid="mock-start-error">
        <p role="alert">{error}</p>
      </section>
    );
  }

  if (!loaded) {
    return (
      <section className="mock-start" data-testid="mock-start-loading">
        <p>Loading...</p>
      </section>
    );
  }

  const { config, bankSize, selection } = loaded;

  return (
    <section className="mock-start" data-testid="mock-start">
      <h1>Mock exam</h1>
      <dl className="mock-start-facts">
        <div>
          <dt>Questions</dt>
          <dd>{config.questionCount}</dd>
        </div>
        <div>
          <dt>Time limit</dt>
          <dd>{config.timeLimitMinutes} minutes</dd>
        </div>
        {config.discloseBankSize && (
          <div>
            <dt>Current question bank</dt>
            <dd data-testid="bank-size">{bankSize} questions</dd>
          </div>
        )}
      </dl>

      {config.discloseBankSize && (
        <p className="mock-start-disclosure">
          Questions are drawn from the current bank above. A repeat mock exam may include
          questions you have already seen -- it is not guaranteed to be entirely fresh.
        </p>
      )}

      <p>
        No feedback is shown while the exam is in progress. Answer, skip, revisit, and change
        any of the {config.questionCount} questions freely before you submit; results and
        explanations appear only after submission or when time runs out.
      </p>

      {selection.ok ? (
        <button type="button" onClick={() => onStart(selection.questions, config.timeLimitMinutes)}>
          Start mock exam
        </button>
      ) : (
        <div className="mock-start-shortfall" data-testid="not-enough-content" role="alert">
          <p>Not enough published questions to start a mock exam yet.</p>
          <ul>
            {selection.shortfall.map((s) => (
              <li key={s.domain}>
                {s.domain}: needs {s.needed}, has {s.available}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
