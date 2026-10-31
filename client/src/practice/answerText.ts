/**
 * Display helpers for reviewed explanation text. The content itself is never
 * rewritten (CONTENT-POLICY.md); these only decide what is shown next to UI
 * that already carries the same information.
 */

const LEADING_VERDICT = /^(?:Correct|Incorrect)\.\s+(?=\S)/;

/**
 * About a sixth of explanations open with "Correct." / "Incorrect.", which the
 * verdict label directly above already says. Only that exact leading word and
 * its full stop are dropped, and only when text follows.
 */
export function explanationBody(explanation: string): string {
  return explanation.replace(LEADING_VERDICT, "");
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when the explanation already quotes the excerpt (ignoring case and punctuation). */
export function isExcerptInExplanation(excerpt: string, explanation: string): boolean {
  const e = normalize(excerpt);
  return e.length > 0 && normalize(explanation).includes(e);
}
