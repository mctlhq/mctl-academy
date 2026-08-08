import { test, expect } from "@playwright/test";

const routes = ["/", "/practice", "/mock", "/mistakes", "/dashboard"];

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  for (const route of routes) {
    test(`${route} fits a narrow phone viewport`, async ({ page }) => {
      await page.goto(route);

      const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        navLinks: Array.from(document.querySelectorAll<HTMLElement>(".app-nav-links a")).map((link) => {
          const rect = link.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      }));

      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.navLinks.every((link) => link.left >= 0 && link.right <= layout.viewportWidth)).toBe(true);
    });
  }

  test("home exposes installable app metadata", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect(await manifest.json()).toMatchObject({
      name: "mctl Academy",
      display: "standalone",
      start_url: "/",
    });
  });
});
