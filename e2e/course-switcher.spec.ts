import { test, expect } from "@playwright/test";

// The course switcher is a real, visible control backed by the generated
// catalog — not a decorative dropdown. jsdom can prove the scoping logic;
// only a browser can prove the control ships, is labelled, and offers exactly
// the courses content/courses/*.yaml defines, with the empty ones disabled.
test("course switcher lists canonical courses and disables the empty ones", async ({ page }) => {
  await page.goto("/practice");

  const select = page.getByTestId("course-select");
  await expect(select).toBeVisible();

  const options = await select.locator("option").evaluateAll((els) =>
    (els as HTMLOptionElement[]).map((o) => ({
      value: o.value,
      label: o.textContent?.trim() ?? "",
      disabled: o.disabled,
    })),
  );
  expect(options.length).toBeGreaterThan(0);

  // The selected course has published questions, and practice content renders.
  await expect(page.locator(".practice .stem")).toBeVisible();
  const selectedValue = await select.inputValue();
  expect(selectedValue).not.toBe("");
  expect(options.find((o) => o.value === selectedValue)?.disabled).toBe(false);

  // Every course in the catalog is offered, whether or not it has content.
  // Asserted positively: the loop below is vacuous once every course has
  // published questions, so on its own it would pass while proving nothing.
  const courseCount = (await import("../client/src/course-catalog.json", { with: { type: "json" } })).default
    .length;
  expect(options.length).toBe(courseCount);
  expect(options.every((o) => o.label !== "")).toBe(true);

  // Any course without published questions is offered but not selectable.
  for (const option of options.filter((o) => o.disabled)) {
    expect(option.label).toContain("Coming soon");
  }
});

test("no runtime content-safety endpoint is part of the learner flow", async ({ page }) => {
  // Learner safety is a build-time property of the shipped bundle. If a
  // /api/quarantine-style runtime gate ever comes back, this fails.
  const requests: string[] = [];
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));

  await page.goto("/practice");
  await expect(page.locator(".practice .stem")).toBeVisible();

  expect(requests.filter((p) => p.startsWith("/api/quarantine"))).toEqual([]);

  // The path is not an API at all any more — it falls through to the SPA
  // shell, so what matters is that no quarantine payload comes back.
  const res = await page.request.get("/api/quarantine");
  expect(await res.text()).not.toContain("quarantinedQuestionIds");
});

// Home's course grid is a second way into a course, so it has to agree with
// the switcher: a card's Practice opens that course's bank and selects it.
test("a Home course card's Practice selects that course and opens its bank", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("course-select");
  const current = await select.inputValue();

  const catalog = (await import("../client/src/course-catalog.json", { with: { type: "json" } })).default;
  await expect(page.getByTestId("course-card")).toHaveCount(catalog.length);

  const other = catalog.find((c) => c.available && c.id !== current);
  expect(other, "needs two available courses").toBeTruthy();
  const card = page.locator(`[data-testid="course-card"][data-course-id="${other!.id}"]`);
  await expect(card.getByRole("heading", { name: other!.title })).toBeVisible();
  await card.getByRole("link", { name: `Practice ${other!.title}` }).click();

  await expect(page).toHaveURL(/\/practice$/);
  await expect(select).toHaveValue(other!.id);
  await expect(page.locator(".practice .stem")).toBeVisible();
});
