import { parseRestrictedMarkdown } from "../markdown";

/** Renders restricted Markdown (backtick code spans only) as React text nodes -- never dangerouslySetInnerHTML. */
export function RestrictedMarkdown({ text }: { text: string }) {
  const segments = parseRestrictedMarkdown(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "code" ? (
          <code key={index}>{segment.value}</code>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}
