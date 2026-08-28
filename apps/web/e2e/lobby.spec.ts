import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("keyboard-only create and join reach lobby with no serious axe violations", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const joinContext = await browser.newContext();
  const host = await hostContext.newPage();
  const joiner = await joinContext.newPage();

  try {
    await host.goto("/?adapter=mock");
    await expectNoSeriousAxeViolations(host);
    await tabToId(host, "create-name");
    await host.keyboard.type("Alice");
    await host.keyboard.press("Enter");
    await expect(host).toHaveURL(/\/room\/MOCK01$/);
    await expect(host.getByRole("heading", { name: "Lobby", exact: true })).toBeVisible();
    await expectNoSeriousAxeViolations(host);

    await joiner.goto("/?adapter=mock");
    await tabToId(joiner, "join-code");
    await joiner.keyboard.type("MOCK01");
    await joiner.keyboard.press("Tab");
    await joiner.keyboard.type("Bob");
    await joiner.keyboard.press("Enter");
    await expect(joiner).toHaveURL(/\/room\/MOCK01$/);
    await expect(joiner.getByRole("heading", { name: "Lobby", exact: true })).toBeVisible();
    await expect(joiner.getByText("Bob (you)")).toBeVisible();
    await expectNoSeriousAxeViolations(joiner);
  } finally {
    await hostContext.close();
    await joinContext.close();
  }
});

async function tabToId(page: Page, id: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const activeId = await page.evaluate(() => document.activeElement?.id ?? "");
    if (activeId === id) {
      return;
    }
    await page.keyboard.press("Tab");
  }

  throw new Error(`Could not reach #${id} with Tab`);
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);
}
