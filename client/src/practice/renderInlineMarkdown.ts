/**
 * Restricted inline Markdown renderer for `stem`/option `text`.
 *
 * A direct port of scripts/build-preview.mjs's esc()/md() pair: escape every
 * HTML-significant character, then convert only backtick code spans to
 * <code>. Nothing else is interpreted. The content schema allows Markdown in
 * these fields, but a renderer that interpreted arbitrary markup would be a
 * script-injection surface for content nobody has reviewed yet — the same
 * reasoning that keeps build-preview.mjs's renderer restricted, and the two
 * must agree since they read the same schema-validated fields.
 */

export const escapeHtml = (s = ""): string =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

export const renderInlineMarkdown = (s = ""): string =>
  escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>");
