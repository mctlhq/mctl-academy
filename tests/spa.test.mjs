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
const ogUrl = (html) => attr(html, /<meta[^>]*property="og:url"[^>]*content="([^"]*)"/);

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
  test("/ and every router page answer 200 with the right canonical", async () => {
    {
      const res = await app.request("/");
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.equal(robots(html), "index, follow");
      assert.equal(canonical(html), "https://academy.mctl.ai/");
      assert.equal(ogUrl(html), "https://academy.mctl.ai/");
    }
    // The user-specific pages are noindex in the header; the page must say
    // the same, and must not name the home page as its canonical (noindex
    // plus a canonical to another URL is a contradictory pair).
    const noindexPages = {
      "/mistakes": "/mistakes",
      "/mock": "/mock",
      "/dashboard": "/dashboard",
      "/admin/stats": "/admin/stats",
      "/Mock": "/mock",
      "/dashboard/": "/dashboard",
    };
    for (const [path, own] of Object.entries(noindexPages)) {
      const res = await app.request(path);
      assert.equal(res.status, 200, path);
      const html = await res.text();
      assert.equal(res.headers.get("x-robots-tag"), "noindex, follow", path);
      assert.equal(robots(html), "noindex, follow", path);
      assert.equal(canonical(html), `https://academy.mctl.ai${own}`, path);
      assert.equal(ogUrl(html), `https://academy.mctl.ai${own}`, path);
      assert.match(html, /<link data-default="https:\/\/academy\.mctl\.ai\/" rel="canonical"/, path);
    }
    for (const path of ["/practice", "/practice/", "/Practice"]) {
      const res = await app.request(path);
      assert.equal(res.status, 200, path);
      const html = await res.text();
      assert.equal(robots(html), "index, follow", path);
      assert.equal(canonical(html), "https://academy.mctl.ai/practice", path);
      assert.equal(ogUrl(html), "https://academy.mctl.ai/practice", path);
      assert.ok(!html.includes("data-default"), `${path} must not set data-default`);
      const meta = (re) => attr(html, re);
      assert.equal(title(html), "Practice · mctl academy", path);
      assert.equal(
        meta(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/),
        "Practice · mctl academy",
        path,
      );
      const desc = meta(/<meta\s+name="description"\s+content="([^"]*)"/);
      assert.ok(desc && !desc.includes("Free Agentic AI Certification"), `${path} has its own description`);
      assert.equal(meta(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/), desc, path);
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

  test("a coming-soon course is a real page: 200, its title, its own canonical and Course schema", () => {
    const upcoming = { ...catalog[0], id: "upcoming", title: "Upcoming", available: false };
    const { status, html } = renderSpaPage(SOURCE_INDEX, classifySpaPath("/courses/upcoming", [upcoming]));
    assert.equal(status, 200);
    assert.equal(title(html), "Upcoming — Coming soon · mctl academy");
    assert.equal(canonical(html), "https://academy.mctl.ai/courses/upcoming");
    assert.match(html, /application\/ld\+json/);
    const jsonLd = JSON.parse(attr(html, /id="schema-course-jsonld">([^<]*)<\/script>/));
    assert.equal(jsonLd["@graph"][0]["@type"], "Course");
    assert.equal(jsonLd["@graph"][1]["@type"], "BreadcrumbList");
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

describe("initial HTML carries content without JavaScript", () => {
  const SITEMAP = readFileSync(new URL("../client/public/sitemap.xml", import.meta.url), "utf8");
  const locs = [...SITEMAP.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const noscript = (html) => html.match(/<noscript><main>([\s\S]*?)<\/main><\/noscript>/)?.[1];

  test("the sitemap lists routes", () => {
    assert.ok(locs.length >= 9, `found ${locs.length} sitemap routes`);
  });

  test("every sitemap route has a heading, links, canonical and og:url in the HTML", () => {
    const titles = new Set();
    for (const loc of locs) {
      const path = new URL(loc).pathname;
      const { status, html } = renderSpaPage(SOURCE_INDEX, classifySpaPath(path, catalog), catalog);
      assert.equal(status, 200, loc);
      const body = noscript(html);
      assert.ok(body, `${loc} has a noscript content block`);
      assert.match(body, /<h1>[^<]+<\/h1>/, loc);
      assert.match(body, /<a href="\/[^"]*">/, `${loc} links`);
      assert.ok(
        body
          .replace(/<[^>]+>/g, " ")
          .split(/\s+/)
          .filter(Boolean).length > 40,
        `${loc} has real text`,
      );
      assert.equal(canonical(html), loc);
      assert.equal(ogUrl(html), loc);
      assert.ok(!titles.has(title(html)), `${loc} title is unique`);
      titles.add(title(html));
      assert.match(html, /<div id="root"><\/div>/, "mount point untouched");
    }
  });

  test("the live handler serves the content block for every sitemap route", async () => {
    for (const loc of locs) {
      const res = await app.request(new URL(loc).pathname);
      assert.equal(res.status, 200, loc);
      assert.match(noscript(await res.text()) ?? "", /<h1>[^<]+<\/h1>/, loc);
    }
  });

  test("GET / is rendered by the SPA handler, not served as the static directory index", async () => {
    const res = await app.request("/");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(noscript(html) ?? "", /<h1>[^<]+<\/h1>/, "root carries the content block");
    assert.equal(canonical(html), "https://academy.mctl.ai/");
    // Static serving is untouched: assets and files still come straight from dist.
    const asset = await app.request(FIXTURE_ASSET);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /console\.log/);
    assert.equal((await app.request("/robots.txt")).status, 200);
    assert.equal((await app.request("/sitemap.xml")).status, 200);
  });

  test("a course page's heading is its own title, escaped", () => {
    const evil = { ...catalog[0], id: "evil", title: "<b>x</b>" };
    const { html } = renderSpaPage(SOURCE_INDEX, { kind: "course", course: evil }, [evil]);
    assert.match(noscript(html), /<h1>&lt;b&gt;x&lt;\/b&gt;<\/h1>/);
  });

  test("404s and user-specific pages get no content block", () => {
    for (const path of ["/nope", "/courses/bogus", "/dashboard", "/mock", "/mistakes"]) {
      const { html } = renderSpaPage(SOURCE_INDEX, classifySpaPath(path, catalog), catalog);
      assert.doesNotMatch(html, /<noscript><main>/, path);
    }
  });

  test("a template without the mount point fails loudly", () => {
    assert.throws(() => assertSpaTemplate(SOURCE_INDEX.replace('<div id="root"></div>', "")), /id="root"/);
  });
});
