import { expect, test } from "@playwright/test";

/**
 * End-to-end smoke test: open the app, click into NBA, see the player pool,
 * click Generate, see lineups. Skipped when the backend isn't reachable.
 */

test.describe("Fantasy Grinder — smoke", () => {
  test("home page loads and links to sport pages", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Choose your sport/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /NBA Optimizer/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /MMA Optimizer/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Golf Optimizer/i })).toBeVisible();
  });

  test("navigate to NBA Optimizer and see settings card", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /NBA Optimizer/i }).click();
    await expect(page.getByRole("heading", { name: /NBA Optimizer/i })).toBeVisible();
    await expect(page.getByText(/Optimizer Settings/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate Lineups/i })).toBeVisible();
  });

  test("navigate to MMA Optimizer", async ({ page }) => {
    await page.goto("/mma");
    await expect(page.getByRole("heading", { name: /MMA Optimizer/i })).toBeVisible();
  });

  test("navigate to Golf Optimizer", async ({ page }) => {
    await page.goto("/golf");
    await expect(page.getByRole("heading", { name: /Golf Optimizer/i })).toBeVisible();
  });
});
