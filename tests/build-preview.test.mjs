/**
 * The preview renders unreviewed, agent-authored content into HTML, so the
 * escaping is a real boundary rather than a formality: a draft question is
 * text nobody has approved yet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Tags the template itself emits. Anything else came from content. */
const TEMPLATE_TAGS = new Set([
  "h1", "h2", "p", "div", "span", "section", "article",
  "ul", "ol", "li", "a", "code", "em", "br", "header", "footer", "b",
]);

function render(question) {
  const dir = mkdtempSync(join(tmpdir(), "academy-preview-"));
  const out = join(dir, "out");
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    mkdirSync(join(dir, "courses"), { recursive: true });
    copyFileSync(
      join(ROOT, "content", "courses", "agentic-ai-builder.yaml"),
      join(dir, "courses", "agentic-ai-builder.yaml"),
    );
    writeFileSync(join(dir, "questions", "q.yaml"), JSON.stringify(question));
    execFileSync("node", [join(ROOT, "scripts", "build-preview.mjs")], {
      env: { ...process.env, ACADEMY_CONTENT_DIR: dir, ACADEMY_PREVIEW_OUT: out },
      stdio: "ignore",
    });
    const html = readFileSync(join(out, "index.html"), "utf8");
    return { html, body: html.split("<main>")[1] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const question = (over = {}) => ({
  id: "q-xxxxxxxxxxxx",
  course_id: "agentic-ai-builder",
  status: "draft",
  domain: "domain-1",
  objective: "domain-1/api-authentication",
  stem: "Which parameter authenticates a request?",
  options: [
    { id: "a", text: "An API key", correct: true, explanation: "Keys are issued per project." },
    { id: "b", text: "Two", correct: false, explanation: "No." },
    { id: "c", text: "Three", correct: false, explanation: "No." },
    { id: "d", text: "Four", correct: false, explanation: "No." },
  ],
  evidence: [{ source_id: "src-x", excerpt: "authenticate using an API key" }],
  authored: { by: "agent:claude", at: "2026-08-06T00:00:00Z" },
  ...over,
});

test("renders a question with its correct option marked", () => {
  const { body } = render(question());
  assert.match(body, /class="correct"/);
  assert.match(body, /Which parameter authenticates a request\?/);
});

test("marks draft status visibly — unreviewed content must not look approved", () => {
  const { body } = render(question());
  assert.match(body, /pill-draft/);
});

test("escapes hostile content into inert text", () => {
  const { body } = render(
    question({
      stem: "<script>alert(1)</script> and <img src=x onerror=alert(2)>",
      evidence: [{ source_id: "src-x", excerpt: "</style><script>alert(4)</script>" }],
    }),
  );

  // A live tag is "<" followed by a letter; escaped content yields "&lt;".
  // Substring checks are not enough here: the literal text `onerror=` survives
  // escaping and is harmless, because the "<" that would open a tag does not.
  const tags = [...body.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
  const unexpected = [...new Set(tags)].filter((t) => !TEMPLATE_TAGS.has(t));

  assert.deepEqual(unexpected, [], `content injected live tags: ${unexpected.join(", ")}`);
  assert.ok(body.includes("&lt;script&gt;"), "script text should survive as escaped text");
});

test("renders inline code but not arbitrary markup", () => {
  const { body } = render(question({ stem: "Set `response_format` and <b>not this</b>" }));
  assert.match(body, /<code>response_format<\/code>/);
  assert.ok(body.includes("&lt;b&gt;"), "raw HTML in content must stay escaped");
});
