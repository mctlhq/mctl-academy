import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { BundleQuestion } from "../client/src/services/contentBundle";

const bundle: BundleQuestion[] = JSON.parse(
  readFileSync(new URL("../client/src/content-bundle.json", import.meta.url), "utf8"),
);

const course = "agentic-ai-builder";
const bank = bundle.filter((q) => q.course_id === course);

interface CatalogCourse {
  id: string;
  available: boolean;
  mock: { domains: { id: string; mockQuestions: number }[] };
}
const catalog: CatalogCourse[] = JSON.parse(
  readFileSync(new URL("../client/src/course-catalog.json", import.meta.url), "utf8"),
);
/** Mirrors selectMockQuestions: every domain must have at least its quota published. */
const mockComplete = (c: CatalogCourse) =>
  c.available &&
  c.mock.domains.every(
    (d) => bundle.filter((q) => q.course_id === c.id && q.domain === d.id).length >= d.mockQuestions,
  );

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/get-session**", (route) => route.fulfill({ json: null }));
});

test("unanswered-first selection, feedback and cursor survive navigation, reload and course switching", async ({
  page,
}) => {
  const [solved, wrong] = bank;
  await page.addInitScript(
    ({ solved, wrong }) => {
      if (localStorage.getItem("e2e.seeded")) return;
      localStorage.setItem("e2e.seeded", "true");
      localStorage.setItem("mctl_academy_course_id", "agentic-ai-builder");
      localStorage.setItem(
        "mctl_academy_progress_v1",
        JSON.stringify([
          {
            questionId: solved.id,
            domain: solved.domain,
            correct: true,
            attemptedAt: "2026-09-01T00:00:00Z",
          },
          { questionId: wrong.id, domain: wrong.domain, correct: false, attemptedAt: "2026-09-01T00:00:00Z" },
        ]),
      );
    },
    { solved, wrong },
  );
  await page.goto("/practice");
  const stem = page.locator(".stem");
  await expect(stem).toBeVisible();
  expect(await stem.textContent()).not.toBe(solved.stem);
  expect(await stem.textContent()).not.toBe(wrong.stem);
  await page.getByRole("button", { name: /^Skip/ }).click();
  const text = await stem.textContent();
  const optionOrder = await page.locator(".option-text").allTextContents();
  await page.locator(".options button").first().click();
  const feedback = await page.locator(".feedback").textContent();
  await page.getByRole("link", { name: "Progress", exact: true }).click();
  await expect(page.getByText("Questions solved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Practice", exact: true }).click();
  await expect(stem).toHaveText(text!);
  await expect(page.locator(".feedback")).toHaveText(feedback!);
  await page.reload();
  await expect(stem).toHaveText(text!);
  expect(await page.locator(".option-text").allTextContents()).toEqual(optionOrder);
  await page.getByTestId("course-select").selectOption("ai-cloudops-engineer");
  await page.getByTestId("course-select").selectOption(course);
  await expect(stem).toHaveText(text!);
  await expect(page.locator(".feedback")).toHaveText(feedback!);
});

for (const width of [375, 390, 768, 1440]) {
  test(`mobile and desktop answer evidence and actions stay accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/practice");
    await expect(page.locator(".stem")).toBeVisible();
    const info = page.getByRole("button", { name: "Toggle practice context" });
    const next = page.locator(".next");
    const a = await info.boundingBox(),
      b = await next.boundingBox();
    expect(a && b && (a.y + a.height <= b.y || b.y + b.height <= a.y)).toBeTruthy();
    await info.click();
    await expect(page.locator("#practice-context")).toBeVisible();
    await info.click();
    await page.locator(".options button").first().click();
    await page.getByText("Sources and evidence", { exact: true }).click();
    const source = page.locator(".answer-sources a").first();
    await source.scrollIntoViewIfNeeded();
    await expect(source).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/learning-${width}.png`, fullPage: true });
    await next.click();
    await expect(page.locator(".practice .progress")).toContainText("Question 2");
  });
}

test("progress denominator and recommended domain link agree", async ({ page }) => {
  await page.addInitScript(
    (questions) => {
      localStorage.setItem("mctl_academy_course_id", "agentic-ai-builder");
      localStorage.setItem(
        "mctl_academy_progress_v1",
        JSON.stringify(
          questions.map((q) => ({
            questionId: q.id,
            domain: q.domain,
            correct: true,
            attemptedAt: "2026-09-01T00:00:00Z",
          })),
        ),
      );
    },
    bank.slice(0, 5),
  );
  await page.goto("/dashboard");
  await expect(page.locator(".readiness-heading strong")).toHaveText(
    `${Math.round((5 / bank.length) * 100)}%`,
  );
  await expect(page.locator(".accuracy-detail").first()).toContainText("100% (5/5)");
  await page.getByRole("button", { name: "Continue practice" }).click();
  expect(new URL(page.url()).searchParams.get("domain")).toMatch(/^domain-/);
});

test("a short bank explains the mock shortfall and a complete bank starts a mock", async ({ page }) => {
  // Derived from the shipped artefacts, not from a guess about which bank is
  // short today: the Builder bank was short during its evidence recovery and
  // is complete again after it, and this spec must hold in both states.
  const short = catalog.find((c) => !mockComplete(c));
  const complete = catalog.find((c) => mockComplete(c));
  expect(complete, "at least one course must be able to fill its Mock").toBeDefined();
  await page.goto("/mock");
  if (short) {
    await page.getByTestId("course-select").selectOption(short.id);
    await expect(page.getByTestId("not-enough-content")).toBeVisible();
  }
  await page.getByTestId("course-select").selectOption(complete!.id);
  await page.getByRole("button", { name: "Start mock exam" }).click();
  await expect(page.getByTestId("mock-exam")).toBeVisible();
});

test("a fully solved bank offers repetition instead of claiming content is missing", async ({ page }) => {
  await page.addInitScript((questions) => {
    localStorage.setItem(
      "mctl_academy_progress_v1",
      JSON.stringify(
        questions.map((q) => ({
          questionId: q.id,
          domain: q.domain,
          correct: true,
          attemptedAt: "2026-09-01T00:00:00Z",
        })),
      ),
    );
  }, bank);
  await page.goto("/practice");
  await expect(page.getByText("All published questions in this selection are solved.")).toBeVisible();
  await page.getByRole("link", { name: "Repeat all", exact: true }).click();
  await expect(page.locator(".stem")).toBeVisible();
});
