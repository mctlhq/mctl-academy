import type { Question } from "./types";

/**
 * Returns a copy of `question` with its options reordered for display.
 * content/schemas/question.schema.json's `options` array order is authoring
 * order, not display order -- branding.yaml documents shuffled options as
 * part of mock selection. Each option's id/text/correct/explanation travel
 * together; only the array order changes (Fisher-Yates).
 */
export function shuffleOptions(question: Question, rng: () => number = Math.random): Question {
  const options = question.options.slice();
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { ...question, options };
}
