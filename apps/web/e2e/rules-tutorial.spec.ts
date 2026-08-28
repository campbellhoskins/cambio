import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("rules and tutorial are keyboard accessible and axe-clean", async ({ page }) => {
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Cambio rules reference" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await tabToLabel(page, "Search by card, action, score, or lifecycle rule");
  await page.keyboard.type("Black King");
  await expect(page.getByRole("row", { name: /black king/i })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.goto("/tutorial");
  await expect(page.getByRole("heading", { name: "Guided Cambio tutorial" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await tabToButton(page, "Continue");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Acknowledge your peek" })).toBeVisible();
  await tabToButton(page, "Acknowledge as learner");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Coach acknowledges" })).toBeVisible();
  await page.getByRole("button", { name: "Replay scenario" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Peek at your bottom row" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

async function tabToLabel(page: Page, label: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const focused = await page.getByLabel(label).evaluate((element) => element === document.activeElement).catch(() => false);
    if (focused) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach ${label} with Tab`);
}

async function tabToButton(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await page.getByRole("button", { name }).evaluate((button) => button === document.activeElement).catch(() => false)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach ${name} with Tab`);
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);
}
