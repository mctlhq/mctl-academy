import { test, expect, type Page } from "@playwright/test";

const routes = ["/", "/practice", "/mock", "/mistakes", "/dashboard"];

// The five widths this responsive pass was explicitly validated against:
// 375/390 (phone), 768 (tablet — simultaneously T5+T6, see app.css's
// breakpoint reference map), 1024 (desktop nav, streak hidden), 1440
// (full desktop).
const VALIDATION_WIDTHS = [375, 390, 768, 1024, 1440];

// Touch-target ergonomics only matter at phone/tablet widths — 1024/1440
// are mouse-primary, so a 44px minimum would be a false requirement there.
const TOUCH_TARGET_WIDTHS = [375, 390, 768];

const MIN_TOUCH_TARGET_PX = 44;

async function assertNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const { documentWidth, bodyWidth } = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  // Checked on both: a stray child can overflow the body without the
  // documentElement itself growing, and vice versa.
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
}

async function assertNavControlsInBounds(page: Page, viewportWidth: number) {
  const boxes = await page
    .locator(".app-nav-link, .theme-toggle, .course-select, .app-brand")
    .evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewportWidth);
  }
}

/**
 * Found on a real Pixel 7 during the real-device validation pass: at
 * <=980px `.app-nav` becomes a `minmax(0,1fr) auto` grid, and that `0`
 * track minimum lets `.app-brand`'s column shrink well past its own text's
 * min-content width. Without `overflow: hidden` on `.app-brand`, the
 * "mctl academy" text doesn't clip at that shrunk box — it renders past its
 * own edge and visually overlaps `.course-select` next to it (reproduced
 * headlessly at exactly 375px, so this was never Android-specific). Bounds
 * checks alone don't catch this: both elements can individually sit inside
 * [0, viewportWidth] while still overlapping each other.
 */
async function assertNoOverlap(page: Page, selectorA: string, selectorB: string) {
  const [a, b] = await Promise.all([
    page.locator(selectorA).first().boundingBox(),
    page.locator(selectorB).first().boundingBox(),
  ]);
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  const horizontallySeparate = a!.x + a!.width <= b!.x || b!.x + b!.width <= a!.x;
  const verticallySeparate = a!.y + a!.height <= b!.y || b!.y + b!.height <= a!.y;
  expect(horizontallySeparate || verticallySeparate).toBe(true);
}

/**
 * Measures the height of every element matching `selector` and asserts
 * each is >= MIN_TOUCH_TARGET_PX.
 *
 * Only used for controls whose CSS sets an explicit `min-height`/`height`
 * of >= 2.75rem (44px) — a hard floor CSS enforces regardless of content or
 * which font actually loaded. Controls sized only by padding + line-height
 * (e.g. Practice's `.options button`, the `MButton`-based "Next question"
 * label) are deliberately excluded: their rendered height depends on
 * `--font-display`'s line metrics, which differ between the custom webfont
 * and its `system-ui`/`-apple-system` fallback — asserting a hard pixel
 * floor on those would be measuring font-loading behavior, not layout, and
 * would be liable to flake between environments rather than catch a real
 * regression.
 */
async function assertTouchTargets(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  }
}

test.describe("responsive layout matrix", () => {
  for (const width of VALIDATION_WIDTHS) {
    test.describe(`${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      for (const route of routes) {
        test(`${route} has no horizontal overflow and a bounded nav`, async ({ page }) => {
          await page.goto(route);
          await assertNoHorizontalOverflow(page, width);
          await assertNavControlsInBounds(page, width);
          await assertNoOverlap(page, ".app-brand", ".course-select");
        });
      }
    });
  }

  test.describe("390px", () => {
    test.use({ viewport: { width: 390, height: 844 } });

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
});

test.describe("touch targets", () => {
  for (const width of TOUCH_TARGET_WIDTHS) {
    test.describe(`${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test("AppNav controls meet the 44px touch-target convention", async ({ page }) => {
        await page.goto("/");
        await assertTouchTargets(page, ".app-nav-link");
        await assertTouchTargets(page, ".theme-toggle");
        await assertTouchTargets(page, ".course-select");
      });

      test("Practice's context toggle and report button meet the 44px touch-target convention", async ({
        page,
      }) => {
        await page.goto("/practice");
        await expect(page.locator(".practice .stem")).toBeVisible();

        await assertTouchTargets(page, ".context-toggle");
        await assertTouchTargets(page, ".report-button");
      });

      test("in-progress Mock exam controls meet the 44px touch-target convention", async ({ page }) => {
        await page.goto("/mock");
        // The Builder bank cannot fill its Mock while recovery is in progress,
        // so pin the spec to a course whose Mock is available (as mock-exam.spec.ts does).
        await page.getByTestId("course-select").selectOption("ai-cloudops-engineer");
        await page.getByRole("button", { name: "Start mock exam" }).click();
        await expect(page.getByTestId("mock-exam")).toBeVisible();

        await assertTouchTargets(page, ".mock-exam-nav-item");
        // The effective click target is the <label>, not the radio input it
        // wraps (a native radio's intrinsic ~13px box is not what the
        // learner taps).
        await assertTouchTargets(page, ".mock-exam-option");
        await assertTouchTargets(page, ".mock-exam-footer button");
      });
    });
  }
});

test.describe("Practice context panel at 768px", () => {
  test("expanded sidebar does not shrink the question column below the 375px mobile baseline", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/practice");
    await expect(page.locator(".practice .stem")).toBeVisible();
    const mobileBox = await page.locator(".practice-stage > .practice").boundingBox();
    expect(mobileBox).not.toBeNull();

    await page.setViewportSize({ width: 768, height: 900 });
    // Force the worst case: the context panel takes its full inline-sidebar
    // width (15rem) out of the question column, rather than sitting
    // collapsed at 3rem.
    await page.locator(".context-toggle").click();
    await expect(page.locator(".practice-shell.context-open")).toBeVisible();
    const tabletBoxWithContextOpen = await page.locator(".practice-stage > .practice").boundingBox();
    expect(tabletBoxWithContextOpen).not.toBeNull();

    expect(tabletBoxWithContextOpen!.width).toBeGreaterThanOrEqual(mobileBox!.width);
  });
});

test.describe("Practice/Mistakes floating context toggle vs. footer", () => {
  /**
   * Found on a real Pixel 7: `.practice-context` (PracticeContent.vue)
   * becomes a `position: fixed` bottom-right pill at <=680px, the same
   * breakpoint AppFooter switches to being hidden on focused-practice routes
   * (app.css). Below that threshold AppFooter must stay hidden so it can
   * never render underneath the fixed pill; above it, the pill goes back to
   * being an inline sidebar column and the footer must reappear normally.
   */
  for (const width of [375, 390, 620, 680]) {
    test(`${width}px: AppFooter is hidden on /practice so it can't sit under the floating toggle`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/practice");
      await expect(page.locator(".practice .stem")).toBeVisible();
      await expect(page.locator(".context-toggle")).toBeVisible();
      await expect(page.locator(".app-footer-safe")).toBeHidden();
    });
  }

  test("700px: AppFooter is visible again once the context panel is back to an inline sidebar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto("/practice");
    await expect(page.locator(".practice .stem")).toBeVisible();
    await expect(page.locator(".app-footer-safe")).toBeVisible();
  });

  test("375px: AppFooter stays visible on unrelated routes (Home, Mock, Dashboard)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    for (const route of ["/", "/mock", "/dashboard"]) {
      await page.goto(route);
      await expect(page.locator(".app-footer-safe")).toBeVisible();
    }
  });
});
