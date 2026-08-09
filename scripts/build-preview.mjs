#!/usr/bin/env node
/**
 * Static course preview.
 *
 * Renders the outline, coverage and current bank straight from content/ into
 * a single self-contained HTML file. No application, no database, no login —
 * Phase 0 exists to prove the content pipeline produces something coherent,
 * and this is the artifact that shows it.
 *
 * Note that this renders options in their authored order, unshuffled. That is
 * deliberate: the preview is where an authoring bias in the bank is visible,
 * which is exactly how the all-answers-in-position-a problem was caught.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = new URL("..", import.meta.url).pathname;
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");
const OUT = process.env.ACADEMY_PREVIEW_OUT ? resolve(process.env.ACADEMY_PREVIEW_OUT) : join(ROOT, "dist", "preview");

const load = (dir) => {
  const p = join(CONTENT, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parseYaml(readFileSync(join(p, f), "utf8")));
};

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Restricted inline markdown only: backtick code and nothing else. The content
// schema allows Markdown, but a preview that interpreted arbitrary markup
// would be a script-injection surface for content nobody has reviewed yet.
const md = (s = "") => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

// Course metadata comes from content/courses/*.yaml — the canonical, and only,
// definition of a course. The preview renders one section per course.
const courses = load("courses").sort((a, b) => String(a.id).localeCompare(String(b.id)));
const questions = load("questions");
const sources = load("sources");

const byObjective = new Map();
for (const q of questions) {
  if (!byObjective.has(q.objective)) byObjective.set(q.objective, []);
  byObjective.get(q.objective).push(q);
}

const totalObjectives = courses.reduce(
  (n, c) => n + (c.domains ?? []).reduce((m, d) => m + (d.objectives?.length ?? 0), 0),
  0,
);
const covered = [...byObjective.keys()].length;
const published = questions.filter((q) => q.status === "published").length;

const statusPill = (s) => `<span class="pill pill-${s}">${esc(s)}</span>`;

const questionHtml = (q) => `
<article class="q" id="${esc(q.id)}">
  <header>
    ${statusPill(q.status)}
    <span class="qid">${esc(q.id)}</span>
  </header>
  <p class="stem">${md(q.stem)}</p>
  <ol class="opts">
    ${q.options
      .map(
        (o) => `<li class="${o.correct ? "correct" : ""}">
        <span class="ol">${esc(o.id)}</span>
        <div><p>${md(o.text)}</p><p class="exp">${md(o.explanation)}</p></div>
      </li>`,
      )
      .join("")}
  </ol>
  <footer>
    ${q.evidence
      .map((e) => {
        const src = sources.find((s) => s.id === e.source_id);
        const href = src ? esc(src.url) : "#";
        return `<div class="ev">&ldquo;${md(e.excerpt)}&rdquo; &mdash; <a href="${href}">${esc(e.source_id)}</a></div>`;
      })
      .join("")}
  </footer>
</article>`;

const domainHtml = (courseId) => (d) => {
  const qs = questions.filter((q) => q.course_id === courseId && q.domain === d.id);
  return `
<section class="domain">
  <h2>${esc(d.title)} <span class="weight">${d.weight}%</span></h2>
  <p class="meta">${qs.length} question${qs.length === 1 ? "" : "s"} &middot; ${d.mock_questions} in a mock &middot;
    ${(d.objectives ?? []).length} objectives</p>
  <ul class="objs">
    ${(d.objectives ?? [])
      .map((o) => {
        const key = `${d.id}/${o.id}`;
        const n = byObjective.get(key)?.length ?? 0;
        return `<li class="${n ? "has" : "empty"}">${esc(o.title)} <span class="n">${n || "—"}</span></li>`;
      })
      .join("")}
  </ul>
  ${qs.map(questionHtml).join("")}
</section>`;
};

const courseHtml = (c) => {
  const qs = questions.filter((q) => q.course_id === c.id);
  return `
<section class="course">
  <h1>${esc(c.title)}</h1>
  <p class="meta">${esc(c.description)}</p>
  <div class="disclaimer">${esc(c.disclaimer?.full ?? "")}</div>
  <div class="stats">
    <div><b>${qs.length}</b> questions</div>
    <div><b>${qs.filter((q) => q.status === "published").length}</b> published</div>
    <div><b>${c.mock?.question_count ?? 0}</b> per mock &middot; ${c.mock?.time_limit_minutes ?? 0} min</div>
  </div>
  ${(c.domains ?? []).map(domainHtml(c.id)).join("")}
</section>`;
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>mctl Academy content preview</title>
<style>
  :root { --fg:#16161a; --mut:#6b6b76; --line:#e4e4ea; --ok:#0a7d4a; --okbg:#eaf7f0; --bg:#fff; --code:#f4f4f7; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e9e9ee; --mut:#a0a0ad; --line:#2c2c34; --ok:#4ade80; --okbg:#12281d; --bg:#131317; --code:#1e1e24; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem 5rem; background:var(--bg); color:var(--fg);
    font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size:1.6rem; margin:0 0 .25rem; }
  h2 { font-size:1.2rem; margin:2.5rem 0 .25rem; }
  code { background:var(--code); padding:.1em .35em; border-radius:4px; font-size:.9em; }
  a { color:inherit; }
  .disclaimer { border:1px solid var(--line); border-left-width:3px; padding:.75rem 1rem;
    border-radius:6px; color:var(--mut); font-size:.9rem; margin:1.25rem 0 2rem; }
  .stats { display:flex; flex-wrap:wrap; gap:1.5rem; padding:1rem 0; border-top:1px solid var(--line);
    border-bottom:1px solid var(--line); }
  .stats div { font-size:.85rem; color:var(--mut); }
  .stats b { display:block; font-size:1.5rem; color:var(--fg); font-weight:600; }
  .meta, .weight { color:var(--mut); font-size:.85rem; font-weight:400; }
  .objs { list-style:none; padding:0; margin:.75rem 0 1.5rem; }
  .objs li { display:flex; justify-content:space-between; gap:1rem; padding:.3rem 0;
    border-bottom:1px dashed var(--line); font-size:.9rem; }
  .objs .empty { color:var(--mut); }
  .objs .n { font-variant-numeric:tabular-nums; color:var(--mut); }
  .q { border:1px solid var(--line); border-radius:8px; padding:1rem 1.15rem; margin:1rem 0; }
  .q header { display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem; }
  .qid { font-family:ui-monospace,monospace; font-size:.75rem; color:var(--mut); }
  .pill { font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; padding:.15rem .45rem;
    border-radius:99px; border:1px solid var(--line); color:var(--mut); }
  .stem { font-weight:500; margin:.25rem 0 .75rem; }
  .opts { list-style:none; padding:0; margin:0; counter-reset:o; }
  .opts li { display:flex; gap:.6rem; padding:.5rem .6rem; border-radius:6px; margin-bottom:.25rem; }
  .opts li.correct { background:var(--okbg); }
  .opts li.correct .ol { color:var(--ok); font-weight:700; }
  .ol { font-family:ui-monospace,monospace; font-size:.8rem; color:var(--mut); padding-top:.15rem; }
  .opts p { margin:0; }
  .exp { color:var(--mut); font-size:.85rem; margin-top:.15rem !important; }
  .ev { margin-top:.75rem; padding-top:.6rem; border-top:1px solid var(--line);
    color:var(--mut); font-size:.8rem; }
</style>
</head>
<body>
<main>
  <div class="disclaimer">
    This is a preview generated from <code>content/</code>. Questions shown as
    <em>draft</em> or <em>needs_review</em> have not been approved by a human reviewer, or cite a
    source that has drifted — neither ships to learners. Options appear in authored
    order — the application shuffles them at attempt time.
  </div>

  <div class="stats">
    <div><b>${courses.length}</b> courses</div>
    <div><b>${questions.length}</b> questions</div>
    <div><b>${published}</b> published</div>
    <div><b>${sources.length}</b> sources</div>
    <div><b>${covered}/${totalObjectives}</b> objectives covered</div>
  </div>

  ${courses.map(courseHtml).join("")}
</main>
</body>
</html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), html);
console.log(
  `Preview written to ${join(OUT, "index.html")} — ${questions.length} questions, ` +
    `${covered}/${totalObjectives} objectives, ${sources.length} sources.`,
);
