import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COURSE_HEAD_TAGS,
  COURSE_JSONLD_ID,
  COURSE_NOT_FOUND_TITLE,
  PAGE_NOT_FOUND_TITLE,
  courseHeadMeta,
} from "../client/src/seo/courseMeta.mjs";
import { COURSE_PATH_PREFIX, STATIC_SPA_PATHS } from "../client/src/seo/spaRoutes.mjs";

/**
 * The SPA document: index.html with the right HTTP status and head tags.
 *
 * Before this existed every unmatched path (an /api typo, /llms.txt, a
 * course id that never existed) came back 200 with the home page's head, and
 * a course page showed crawlers and link previews the home page's title,
 * description and canonical until JavaScript ran. Now:
 *
 * - the router's fixed pages and /courses/<catalog id> answer 200;
 * - a course page carries its own title, description, canonical, Open Graph
 *   and Twitter tags and its JSON-LD, built by the same module CourseView.vue
 *   uses (client/src/seo/courseMeta.mjs);
 * - everything else answers 404 with `robots: noindex`, and the client still
 *   renders its not-found view from the same document.
 *
 * The client imports the shared modules from client/src/seo/, and so does
 * this file; the Dockerfile copies that directory and course-catalog.json
 * into the runtime image for exactly this reason.
 */

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = join(SERVER_DIR, "..", "client", "src", "course-catalog.json");

/**
 * Reads the generated course catalog. Throws rather than returning an empty
 * list: a catalog that could not be read is not a catalog with no courses,
 * and treating it as one would 404 every course page while looking healthy.
 */
export function loadCourseCatalog(path = DEFAULT_CATALOG_PATH) {
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(catalog) || catalog.some((c) => !c || typeof c.id !== "string")) {
    throw new Error(`course catalog at ${path} is not an array of courses`);
  }
  return catalog;
}

/**
 * Which page a request path is, mirroring how vue-router matches it:
 * case-insensitive, one optional trailing slash, and `/courses/:courseId`
 * as a single segment. The course id itself is compared exactly, as
 * CourseView's findCourse() does.
 */
export function classifySpaPath(rawPath, catalog) {
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const lower = path.toLowerCase();
  if (STATIC_SPA_PATHS.includes(lower)) return { kind: "page" };
  if (lower.startsWith(COURSE_PATH_PREFIX)) {
    const id = path.slice(COURSE_PATH_PREFIX.length);
    if (id && !id.includes("/")) {
      const course = catalog.find((c) => c.id === id);
      return course ? { kind: "course", course } : { kind: "course-not-found" };
    }
  }
  return { kind: "not-found" };
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * JSON for a `<script type="application/ld+json">` body. JSON.parse gives
 * back the identical object, but no `</script>` or `<!--` can end the block
 * early, whatever a course title contains.
 */
export function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ROBOTS_TAG = { tag: "meta", match: ["name", "robots"], attr: "content" };
const TITLE_RE = /<title>[\s\S]*?<\/title>/g;
const HEAD_CLOSE_RE = /<\/head>/g;

function tagRegex(spec) {
  const [name, value] = spec.match;
  return new RegExp(`<${spec.tag}\\b[^>]*\\s${name}="${escapeRegex(value)}"[^>]*>`, "g");
}

function countMatches(html, re) {
  return (html.match(re) ?? []).length;
}

/**
 * Fails loudly when index.html lacks a tag this module rewrites. Silently
 * skipping a missing tag would ship course pages with the home page's
 * canonical again, which is the bug this file exists to fix.
 */
export function assertSpaTemplate(html) {
  const problems = [];
  for (const spec of [...COURSE_HEAD_TAGS, ROBOTS_TAG]) {
    const n = countMatches(html, tagRegex(spec));
    if (n !== 1) problems.push(`<${spec.tag} ${spec.match[0]}="${spec.match[1]}"> found ${n} times`);
  }
  if (countMatches(html, TITLE_RE) !== 1) problems.push("<title> must appear exactly once");
  if (countMatches(html, HEAD_CLOSE_RE) !== 1) problems.push("</head> must appear exactly once");
  if (problems.length > 0) {
    throw new Error(`index.html cannot be rendered per route: ${problems.join("; ")}`);
  }
  return html;
}

/**
 * Sets one attribute on the single tag `spec` names. With `keepDefault`, the
 * tag also gets `data-default` holding the value it replaced, so CourseView
 * can restore the site defaults on navigating away from a server-rendered
 * course page instead of "restoring" the course's own values.
 */
function setTagAttr(html, spec, value, { keepDefault = false } = {}) {
  const attrRe = new RegExp(`\\s${spec.attr}="([^"]*)"`);
  return html.replace(tagRegex(spec), (tag) => {
    const current = tag.match(attrRe);
    if (!current) throw new Error(`<${spec.tag} ${spec.match[0]}="${spec.match[1]}"> has no ${spec.attr}`);
    let out = tag.replace(attrRe, () => ` ${spec.attr}="${escapeHtml(value)}"`);
    if (keepDefault) {
      // current[1] is already HTML-escaped attribute text from index.html.
      out = out.replace(`<${spec.tag}`, () => `<${spec.tag} data-default="${current[1]}"`);
    }
    return out;
  });
}

function setTitle(html, title) {
  return html.replace(TITLE_RE, () => `<title>${escapeHtml(title)}</title>`);
}

function notFound(html, title) {
  return { status: 404, html: setTagAttr(setTitle(html, title), ROBOTS_TAG, "noindex") };
}

/** index.html as it should be served for one classified path. */
export function renderSpaPage(template, page) {
  switch (page.kind) {
    case "page":
      return { status: 200, html: template };
    case "course": {
      const meta = courseHeadMeta(page.course);
      let html = setTitle(template, meta.title);
      if (meta.jsonLd) {
        for (const spec of COURSE_HEAD_TAGS) {
          html = setTagAttr(html, spec, meta[spec.field], { keepDefault: true });
        }
        const script = `<script type="application/ld+json" id="${COURSE_JSONLD_ID}">${jsonForScript(meta.jsonLd)}</script>`;
        html = html.replace(HEAD_CLOSE_RE, () => `  ${script}\n  </head>`);
      }
      return { status: 200, html };
    }
    case "course-not-found":
      return notFound(template, COURSE_NOT_FOUND_TITLE);
    default:
      return notFound(template, PAGE_NOT_FOUND_TITLE);
  }
}

/**
 * Hono handler serving index.html per route. The template is read once and
 * kept: client/dist only changes with a new image.
 *
 * A missing index.html is answered 503, not 404 and not a 500 stack trace:
 * the page may well exist, but this server cannot know -- the image (or a
 * local checkout) has no client build. It is logged once per process, not
 * per request, and not cached, so a build appearing later is picked up. Any
 * other read failure, or a template missing a tag renderSpaPage rewrites,
 * still throws to app.onError: those are bugs, not a missing build.
 *
 * @param {{ indexPath: string, catalog: Array<{ id: string }>, log?: { error(message: string): void } }} options
 */
export function createSpaHandler({ indexPath, catalog, log = console }) {
  let template = null;
  let reportedMissing = false;
  return async (c) => {
    if (template === null) {
      let raw;
      try {
        raw = await readFile(indexPath, "utf8");
      } catch (err) {
        if (err?.code !== "ENOENT") throw err;
        if (!reportedMissing) {
          reportedMissing = true;
          log.error(`[spa] ${indexPath} not found -- the client is not built; SPA paths answer 503.`);
        }
        return c.text("Service unavailable: client build missing", 503);
      }
      template = assertSpaTemplate(raw);
    }
    const { status, html } = renderSpaPage(template, classifySpaPath(c.req.path, catalog));
    if (status === 404) c.header("X-Robots-Tag", "noindex");
    return c.html(html, status);
  };
}
