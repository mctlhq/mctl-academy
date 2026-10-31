import { test, expect } from "@playwright/test";
import { mockableCourse } from "./mockable-course";

test("mock exam: start, answer one, submit early, see results", async ({ page }) => {
  await page.goto("/mock");
  await page.getByTestId("course-select").selectOption(mockableCourse());

  const startButton = page.getByRole("button", { name: "Start mock exam" });
  await expect(startButton).toBeVisible();
  await startButton.click();

  const exam = page.getByTestId("mock-exam");
  await expect(exam).toBeVisible();

  // Answer only the first question, then submit — deliberately leaves the
  // rest unanswered to exercise the incomplete-submission confirmation path.
  await page.locator(".mock-exam-option input[type=radio]").first().click();
  await page.getByRole("button", { name: "Submit exam" }).click();

  // The confirmation is a modal dialog; its body names the counts.
  const confirm = page.getByRole("dialog", { name: "Submit the exam?" });
  await expect(confirm.getByTestId("submit-confirm")).toContainText("1 of");
  await confirm.getByRole("button", { name: "Submit anyway" }).click();

  const results = page.getByTestId("mock-results");
  await expect(results).toBeVisible();
  await expect(page.getByTestId("score")).toContainText("correct");
});
