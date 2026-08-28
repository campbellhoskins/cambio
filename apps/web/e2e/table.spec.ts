import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("keyboard-friendly mock match journey reaches final summary with an axe-clean table", async ({ page }) => {
  await page.goto("/?adapter=mock");
  await page.evaluate(() => window.localStorage.removeItem("cambio.mock.rooms"));
  await page.reload();
  await page.getByLabel("Display name for new room").fill("Alice");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("heading", { name: "Lobby", exact: true })).toBeVisible();
  const roomCode = page.url().match(/\/room\/([^/?#]+)/)?.[1];
  if (roomCode === undefined) {
    throw new Error("missing mock room code");
  }

  await goHomeWithoutReload(page);
  await page.getByLabel("Room code").fill(roomCode);
  await page.getByLabel("Display name for joined room").fill("Bob");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByText("Bob (you)")).toBeVisible();

  await resume(page, roomCode, "Alice");
  await page.getByRole("button", { name: "Start match" }).click();
  await expect(page.getByRole("heading", { name: "Game table", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge opening peek" }).click();

  await resume(page, roomCode, "Bob");
  await page.getByRole("button", { name: "Acknowledge opening peek" }).click();

  await resume(page, roomCode, "Alice");
  await page.getByRole("button", { name: "Draw card" }).click();
  await page.getByRole("button", { name: /top left face-down card for alice.*replace with drawn card/i }).click();
  await page.getByRole("button", { name: "Skip power" }).click();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Enter snap mode" }).click();
  await page.getByRole("button", { name: /top left face-down card for bob.*attempt snap/i }).click();
  await expect(page.getByRole("button", { name: /transient wrong snap reveal, 3 of diamonds, for bob/i })).toBeVisible();
  await page.getByRole("button", { name: /top right face-down card for bob.*attempt snap/i }).click();
  await page.getByRole("button", { name: /top right face-down card for alice.*transfer this card/i }).click();

  await page.getByRole("button", { name: "Call Cambio" }).click();
  await resume(page, roomCode, "Bob");
  await page.getByRole("button", { name: "Draw card" }).click();
  await page.getByRole("button", { name: "Discard drawn card" }).click();
  await expect(page.getByRole("heading", { name: "Round results" })).toBeVisible();
  await page.getByRole("button", { name: "Ready for next round" }).click();

  await resume(page, roomCode, "Alice");
  await page.getByRole("button", { name: "Ready for next round" }).click();
  await expect(page.getByRole("heading", { name: "Final match summary" })).toBeVisible();
  await expect(page.getByText(/winner: alice/i).first()).toBeVisible();
});

async function resume(page: Page, roomCode: string, displayName: string): Promise<void> {
  await goHomeWithoutReload(page);
  await page.getByRole("button", { name: `Resume room ${roomCode} as ${displayName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomCode}$`));
}

async function goHomeWithoutReload(page: Page): Promise<void> {
  await page.goto("/?adapter=mock");
  await expect(page.getByRole("heading", { name: "Play Cambio" })).toBeVisible();
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);
}
