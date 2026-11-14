// First, before server/app.mjs: it decides which dist the app serves.
import { FIXTURE_ASSET, FIXTURE_DIST_PREFIX } from "./helpers/client-dist-fixture.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { app } from "../server/app.mjs";
import {
  assertSpaTemplate,
  classifySpaPath,
  createSpaHandler,
  escapeHtml,
  loadCourseCatalog,
  renderSpaPage,
} from "../server/spa.mjs";
import { courseHeadMeta } from "../client/src/seo/courseMeta.mjs";

// The real head of the shipped page; tests/helpers/client-dist-fixture.mjs
// serves this same file as the fixture dist's index.html.
const SOURCE_INDEX = readFileSync(new URL("../client/index.html", import.meta.url), "utf8");
const catalog = loadCourseCatalog();
const COURSE_ID = "ai-cloudops-engineer";

test("the suite serves the fixture dist, never whatever client/dist happens to hold", () => {
  assert.ok(
    process.env.ACADEMY_CLIENT_DIST?.startsWith(join(tmpdir(), FIXTURE_DIST_PREFIX)),
    `ACADEMY_CLIENT_DIST=${process.env.ACADEMY_CLIENT_DIST}`,
  );
});

function attr(html, re) {
  return html.match(re)?.[1];
}

const robots = (html) => attr(html, /<meta\s+name="robots"\s+content="([^"]*)"/);
const title = (html) => attr(html, /<title>([^<]*)<\/title>/);
const canonical = (html) => attr(html, /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/);

describe("unknown paths are real 404s", () => {
  test("an unmatched /api path is a JSON 404, for any method", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await app.request("/api/nope", { method });
      assert.equal(res.status, 404, method);
      assert.match(res.headers.get("content-type"), /application\/json/);
      assert.deepEqual(await res.json(), { error: "not_found" });
    }
  });

  test("an unknown page is index.html with 404 and noindex", async () => {
    for (const path of ["/nope", "/llms.txt", "/courses", "/courses/x/y", "/practice/extra"]) {
      const res = await app.request(path);
      assert.equal(res.status, 404, path);
      assert.match(res.headers.get("content-type"), /text\/html/);
      const html = await res.text();
      assert.match(html, /<div id="root"><\/div>/, `${path} still ships the SPA`);
      assert.equal(robots(html), "noindex", path);
      assert.equal(res.headers.get("x-robots-tag"), "noindex", path);
      assert.equal(title(html), "Page not found · mctl academy", path);
      assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    }
  });

  test("a course id outside the catalog is a 404 with noindex", async () => {
    const res = await app.request("/courses/bogus");
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.equal(robots(html), "noindex");
    assert.equal(title(html), "Course not found · mctl academy");
  });
});

describe("known pages", () => {
  test("/ and every router page answer 200 with the site defaults", async () => {
    for (const path of ["/", "/practice", "/practice/", "/Practice", "/mistakes", "/mock", "/dashboard"]) {
      const res = await app.request(path);
      assert.equal(res.status, 200, path);
      const html = await res.text();
      assert.equal(robots(html), "index, follow", path);
      assert.equal(canonical(html), "https://academy.mctl.ai/", path);
    }
  });

  test("a catalog course answers 200 with its own head, built by the shared module", async () => {
    const course = catalog.find((c) => c.id === COURSE_ID);
    assert.ok(course, `${COURSE_ID} must be in the catalog for this test to mean anything`);
    const meta = courseHeadMeta(course);

    const res = await app.request(`/courses/${COURSE_ID}`);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.equal(title(html), escapeHtml(meta.title));
    assert.equal(canonical(html), `https://academy.mctl.ai/courses/${COURSE_ID}`);
    assert.equal(robots(html), "index, follow");
    for (const [re, expected] of [
      [/<meta[^>]*name="description"[^>]*content="([^"]*)"/, meta.description],
      [/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/, meta.title],
      [/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/, meta.description],
      [/<meta[^>]*property="og:url"[^>]*content="([^"]*)"/, meta.canonicalUrl],
      [/<meta[^>]*name="twitter:title"[^>]*content="([^"]*)"/, meta.title],
      [/<meta[^>]*name="twitter:description"[^>]*content="([^"]*)"/, meta.description],
    ]) {
      assert.equal(attr(html, re), escapeHtml(expected), String(re));
    }
    // The home page's values survive only as data-default, for CourseView.
    assert.match(html, /<link data-default="https:\/\/academy\.mctl\.ai\/" rel="canonical"/);

    const jsonLd = attr(
      html,
      /<script type="application\/ld\+json" id="schema-course-jsonld">([^<]*)<\/script>/,
    );
    assert.deepEqual(JSON.parse(jsonLd), meta.jsonLd);
  });

  test("a coming-soon course is a real page: 200, its title, site defaults otherwise", () => {
    const upcoming = { ...catalog[0], id: "upcoming", title: "Upcoming", available: false };
    const { status, html } = renderSpaPage(SOURCE_INDEX, classifySpaPath("/courses/upcoming", [upcoming]));
    assert.equal(status, 200);
    assert.equal(title(html), "Upcoming — Coming Soon · mctl academy");
    assert.equal(canonical(html), "https://academy.mctl.ai/");
    assert.doesNotMatch(html, /application\/ld\+json/);
  });
});

describe("static files are served as before", () => {
  test("assets, robots.txt, sitemap.xml and favicon keep their bytes and types", async () => {
    for (const { path, type } of [
      { path: FIXTURE_ASSET, type: /javascript/ },
      { path: "/robots.txt", type: /text\/plain/ },
      { path: "/sitemap.xml", type: /xml/ },
      { path: "/favicon.ico", type: /icon/ },
    ]) {
      const res = await app.request(path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get("content-type"), type, path);
      assert.doesNotMatch(await res.text(), /<div id="root">/, path);
      assert.match(res.headers.get("content-security-policy"), /default-src 'self'/, path);
    }
  });
});

describe("rendering safety", () => {
  test("injected values are HTML-escaped and cannot close the JSON-LD script", () => {
    const evil = {
      ...catalog[0],
      id: "evil",
      title: `"><script>alert(1)</script></script><!--`,
      available: true,
    };
    const { html } = renderSpaPage(SOURCE_INDEX, { kind: "course", course: evil });
    assert.doesNotMatch(html, /<script>alert/);
    assert.equal(
      (html.match(/<\/script>/g) ?? []).length,
      (SOURCE_INDEX.match(/<\/script>/g) ?? []).length + 1,
    );
    const jsonLd = attr(html, /id="schema-course-jsonld">([^<]*)<\/script>/);
    assert.equal(JSON.parse(jsonLd)["@graph"][1].about.name, evil.title);
  });

  test("index.html carries every tag the renderer rewrites, and a missing one fails loudly", () => {
    assert.doesNotThrow(() => assertSpaTemplate(SOURCE_INDEX));
    const withoutCanonical = SOURCE_INDEX.replace(/<link rel="canonical"[^>]*>/, "");
    assert.throws(() => assertSpaTemplate(withoutCanonical), /rel="canonical"/);
  });
});

describe("no client build", () => {
  test("SPA paths answer 503, logged once, and recover when the build appears", async () => {
    const errors = [];
    const dir = mkdtempSync(join(tmpdir(), "academy-unbuilt-"));
    const indexPath = join(dir, "index.html");
    const probe = new Hono();
    probe.get("/*", createSpaHandler({ indexPath, catalog, log: { error: (m) => errors.push(m) } }));

    for (const path of ["/", "/nope", `/courses/${COURSE_ID}`]) {
      const res = await probe.request(path);
      assert.equal(res.status, 503, path);
      assert.equal(await res.text(), "Service unavailable: client build missing");
    }
    assert.equal(errors.length, 1, "logged once per process, not per request");
    assert.match(errors[0], /not found -- the client is not built/);

    // The failure is not cached: once a build lands, pages are served again.
    writeFileSync(indexPath, SOURCE_INDEX);
    const recovered = await probe.request("/practice");
    assert.equal(recovered.status, 200);
    assert.match(await recovered.text(), /<div id="root"><\/div>/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a read failure other than a missing file is still an error, not a 503", async () => {
    // A directory where index.html should be: EISDIR, a broken image rather
    // than an unbuilt one.
    const probe = new Hono();
    probe.get("/*", createSpaHandler({ indexPath: tmpdir(), catalog, log: { error() {} } }));
    probe.onError((_err, c) => c.text("error", 500));
    const res = await probe.request("/");
    assert.equal(res.status, 500);
  });
});
