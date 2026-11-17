/**
 * Static fallback body for the SPA document, rendered by server/spa.mjs.
 *
 * The page is a client-rendered Vue app: its initial HTML used to be an empty
 * `<div id="root">`, so a no-JavaScript visitor or a crawler that does not
 * run scripts saw about eight words. server/spa.mjs now appends a
 * `<noscript>` block after the mount point carrying the page's real heading,
 * text and links. It is inert when JavaScript runs (browsers do not render
 * `<noscript>` content then), so SPA mounting and the visible UI are
 * unchanged. Plain .mjs and pure (no DOM, no Node APIs), like courseMeta.mjs.
 *
 * Every value comes from the course catalog or the constants below and is
 * HTML-escaped here.
 */

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

export const HOME_HEADING =
  "Practice questions for AI cloud certifications, each one checked against its source.";
export const HOME_LEAD =
  "Every question is written from public product documentation, reviewed independently, and cites the page that supports its answer. Pick a course, practice, review your mistakes, then try a timed mock exam.";
export const PRACTICE_HEADING = "Practice questions";
export const PRACTICE_LEAD =
  "Untimed, scenario-based practice questions for each course. Every question cites the documentation page that supports its answer.";
export const NOSCRIPT_NOTICE =
  "This site's practice sessions need JavaScript. The course overview on this page is plain HTML.";

function courseLinks(catalog, exceptId) {
  const items = catalog
    .filter((c) => c.id !== exceptId)
    .map((c) => `<li><a href="/courses/${esc(c.id)}">${esc(c.title)}</a></li>`)
    .join("");
  return `<ul>${items}</ul>`;
}

function courseBody(course, catalog) {
  const domains = (course.mock?.domains ?? [])
    .map((d) => {
      const objectives = (d.objectives ?? []).map((o) => `<li>${esc(o.title)}</li>`).join("");
      const weight = typeof d.weight === "number" ? ` (${esc(d.weight)}%)` : "";
      return `<li>${esc(d.title)}${weight}${objectives ? `<ul>${objectives}</ul>` : ""}</li>`;
    })
    .join("");
  const stats = course.available
    ? `<p>${esc(course.publishedQuestionCount)} practice questions. Free, no sign-up needed to start.</p>`
    : "<p>Coming soon. The syllabus below is a preview of the planned practice track.</p>";
  return (
    `<h1>${esc(course.title)}</h1>` +
    (course.summary ? `<p>${esc(course.summary)}</p>` : "") +
    stats +
    (domains ? `<h2>Practice domains &amp; syllabus</h2><ul>${domains}</ul>` : "") +
    `<h2>Explore other courses</h2>${courseLinks(catalog, course.id)}` +
    '<p><a href="/">mctl academy home</a></p>'
  );
}

/**
 * Inner HTML of the `<noscript>` block for a page classified by
 * server/spa.mjs, or "" for pages that carry no public content (the
 * user-specific views and 404s). Only sitemap routes get content.
 */
export function noscriptBody(page, catalog) {
  switch (page.kind) {
    case "course":
      return courseBody(page.course, catalog);
    case "page":
      if (page.path === "/") {
        return `<h1>${esc(HOME_HEADING)}</h1><p>${esc(HOME_LEAD)}</p><h2>Courses</h2>${courseLinks(catalog, null)}<p><a href="/practice">Practice</a></p>`;
      }
      if (page.path === "/practice") {
        return `<h1>${esc(PRACTICE_HEADING)}</h1><p>${esc(PRACTICE_LEAD)}</p><h2>Choose a course</h2>${courseLinks(catalog, null)}<p><a href="/">mctl academy home</a></p>`;
      }
      return "";
    default:
      return "";
  }
}

/** The full `<noscript>` element, or "" when the page has no content block. */
export function noscriptBlock(page, catalog) {
  const body = noscriptBody(page, catalog);
  return body ? `<noscript><main>${body}<p>${esc(NOSCRIPT_NOTICE)}</p></main></noscript>` : "";
}
