import { test, expect } from "@playwright/test";

test("practice bank: answer a question and reveal feedback", async ({ page }) => {
  await page.goto("/practice");

  const stem = page.locator(".practice .stem");
  await expect(stem).toBeVisible();

  // Options render as buttons with no feedback until one is picked.
  const options = page.locator(".practice .options li button");
  await expect(options.first()).toBeVisible();
  await options.first().click();

  // Selecting any option reveals a verdict (Correct/Incorrect) and an
  // explanation for the picked option — this is the whole point of the
  // practice flow, unlike the mock exam's deferred feedback.
  await expect(page.locator(".practice .feedback .verdict").first()).toBeVisible();

  // The advance control, not a text match: an option's own text can contain
  // "finish" (a Builder item's distractor does), and then a role+name regex
  // resolves to two buttons and fails strict mode.
  await page.locator(".practice .practice-actions .next").click();
  await expect(page.locator(".practice .progress")).toContainText("Question 2 of");
});
