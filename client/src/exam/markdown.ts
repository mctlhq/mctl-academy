/**
 * Restricted inline Markdown parser, ported from scripts/build-preview.mjs's
 * md()/esc() approach: only backtick code spans are recognized, nothing
 * else. Unlike build-preview.mjs (which escapes to an HTML string), this
 * returns plain segments for a React component to render as text nodes --
 * React never interprets its children as HTML, so raw markup in a question
 * stem/option/explanation can never execute regardless of this parser.
 * content/schemas/question.schema.json documents stem as "restricted
 * Markdown, sanitized at build time" and CONTENT-POLICY.md forbids raw HTML
 * or executable MDX anywhere.
 */

export interface MarkdownSegment {
  type: "text" | "code";
  value: string;
}

export function parseRestrictedMarkdown(input: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const codeSpan = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeSpan.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: input.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", value: match[1] });
    lastIndex = codeSpan.lastIndex;
  }
  if (lastIndex < input.length) {
    segments.push({ type: "text", value: input.slice(lastIndex) });
  }
  return segments;
}
