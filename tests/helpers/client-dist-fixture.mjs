/**
 * A fixed client/dist for the server suites, preloaded into every test
 * process by `test:server` (`node --import ./tests/helpers/client-dist-fixture.mjs`).
 *
 * server/app.mjs serves whatever directory ACADEMY_CLIENT_DIST names, and
 * otherwise ./client/dist. Left to the default, the suites saw a different
 * server depending on whether someone had run the client build: with no
 * dist every SPA path was a 500, with one they were real pages and 404s, and
 * a test that passed in CI (where the build runs after the tests) failed
 * locally. Pointing every run at this fixture removes that dependency.
 *
 * The page is the real client/index.html -- Vite's build keeps its head tags
 * as written -- plus a few static files standing in for the build output.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXTURE_DIST_PREFIX = "academy-client-dist-fixture-";
export const FIXTURE_ASSET = "/assets/index-fixture.js";

const dist = mkdtempSync(join(tmpdir(), FIXTURE_DIST_PREFIX));
writeFileSync(join(dist, "index.html"), readFileSync(new URL("../../client/index.html", import.meta.url)));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, FIXTURE_ASSET), "console.log('app');\n");
writeFileSync(join(dist, "robots.txt"), "User-agent: *\nAllow: /\n");
writeFileSync(join(dist, "sitemap.xml"), '<?xml version="1.0"?><urlset></urlset>\n');
writeFileSync(join(dist, "favicon.ico"), Buffer.from([0, 0, 1, 0]));

process.env.ACADEMY_CLIENT_DIST = dist;
process.on("exit", () => rmSync(dist, { recursive: true, force: true }));
