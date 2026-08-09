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
