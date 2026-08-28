import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

interface SeatState {
  readonly playerId: string;
  readonly displayName: string;
  readonly seatIndex: number;
  readonly connection: "connected" | "disconnected" | "removed";
  readonly sessionGeneration: number;
  readonly removalEligible: boolean;
}

interface CardSlot {
  readonly slotId: string;
  readonly position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight" | null;
  readonly cardId: string | null;
}

interface MatchState {
  readonly revision: number;
  readonly status: "lobby" | "active" | "intermission" | "complete" | "abandoned";
  readonly seats: readonly SeatState[];
  readonly pauseReasons: readonly string[];
  readonly round: null | {
    readonly phase: "dealing" | "openingPeek" | "turnCycle" | "scoring" | "complete";
    readonly turnStage: "turnStart" | "drawn" | "resolving" | null;
    readonly activePlayerId: string | null;
    readonly cards: Record<string, { readonly rank: string; readonly suit: string | null }>;
    readonly drawPile: readonly string[];
    readonly discardPile: readonly string[];
    readonly slotsByPlayer: Record<string, readonly CardSlot[]>;
    readonly drawnCard: { readonly playerId: string; readonly cardId: string } | null;
    readonly pendingPower: { readonly ownerId: string; readonly stage: string } | null;
    readonly snapWindow: { readonly windowId: string; readonly generation: number; readonly triggerRank: string } | null;
    readonly pendingTransfer: { readonly fromPlayerId: string; readonly targetSlotId: string } | null;
  };
  readonly cumulativeScores: Record<string, number>;
}

interface ClientE2EState {
  readonly snapshot: {
    readonly viewerSeatId: string;
    readonly room: { readonly status: MatchState["status"] };
    readonly round: {
      readonly phase: NonNullable<MatchState["round"]>["phase"] | null;
      readonly turnStage: NonNullable<MatchState["round"]>["turnStage"];
    };
  } | null;
  readonly revision: number | null;
  readonly connectionStatus: string;
  readonly lastError: string | null;
  readonly rejections: Record<string, string | undefined>;
}

declare global {
  interface Window {
    __cambioE2E?: {
      readonly getState: () => ClientE2EState;
      readonly sendCommand: (type: string, payload: unknown) => void;
    };
  }
}

interface RoomPages {
  readonly hostContext: BrowserContext;
  readonly joinContext: BrowserContext;
  readonly host: Page;
  readonly joiner: Page;
  readonly roomCode: string;
  readonly origin: string;
}

const roomContexts: BrowserContext[] = [];

test.describe.serial("Phase 11 production-like hardening", () => {
  test.afterEach(async () => {
    await Promise.all(roomContexts.splice(0).map((context) => context.close().catch(() => undefined)));
  });

  test("serves home, lobby, table, rules, and tutorial with no serious axe violations", async ({ browser, page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Play Cambio" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);

    const room = await createTwoPlayerRoom(browser, "Axe Host", "Axe Guest");
    await expectNoSeriousAxeViolations(room.host);
    await startAndAcknowledge(room);
    await expect(room.host.getByRole("heading", { name: "Game table", exact: true })).toBeVisible();
    await expectNoSeriousAxeViolations(room.host);

    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Cambio rules reference" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);

    await page.goto("/tutorial");
    await expect(page.getByRole("heading", { name: "Guided Cambio tutorial" })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });

  test("completes a real-browser two-player match on the same origin without the Vite proxy", async ({ browser }) => {
    const room = await createTwoPlayerRoom(browser, "Alice", "Bob");
    await startAndAcknowledge(room);
    await expectNoHiddenOpponentCardsInDom(room.host, await roomState(room.host, room.roomCode));

    const result = await driveMatchToCompletion(room, { requirePower: true, minimumTurnsBeforeCambio: 3 });
    expect(result.powerSeen).toBe(true);
    expect(result.snapWindowsSeen).toBeGreaterThan(0);
    expect(result.turns).toBeGreaterThanOrEqual(3);

    await expect(room.host.getByRole("heading", { name: "Final match summary" })).toBeVisible();
    const state = await roomState(room.host, room.roomCode);
    expect(state.status).toBe("complete");
    const winners = winnersFromScores(state);
    for (const winner of winners) {
      await expect(room.host.getByText(new RegExp(`Winner.*${escapeRegex(displayName(state, winner))}`, "i"))).toBeVisible();
    }
  });

  test("allows exactly one browser websocket snap racer to win a correct same-target race", async ({ browser }) => {
    const room = await createTwoPlayerRoom(browser, "Snap Alice", "Snap Bob");
    await startAndAcknowledge(room);
    const race = await driveToCorrectSnapWindow(room);
    await waitForClientConnected(room.host, room.roomCode, { status: "active" });
    await waitForClientConnected(room.joiner, room.roomCode, { status: "active" });
    const beforeRace = await roomState(room.host, room.roomCode);
    expect(beforeRace.pauseReasons).toEqual([]);
    expect(beforeRace.round?.snapWindow).toMatchObject({
      windowId: race.snapWindowId,
      generation: race.generation,
    });

    await Promise.all([
      sendClientCommand(room.host, "attemptSnap", {
        snapWindowId: race.snapWindowId,
        generation: race.generation,
        targetPlayerId: race.targetPlayerId,
        slotId: race.slotId,
      }),
      sendClientCommand(room.joiner, "attemptSnap", {
        snapWindowId: race.snapWindowId,
        generation: race.generation,
        targetPlayerId: race.targetPlayerId,
        slotId: race.slotId,
      }),
    ]);
    await expect.poll(async () => (await rejectionCodes(room)).filter((code) => code === "E_SNAP_ALREADY_RESOLVED").length, { timeout: 4_000 }).toBe(1);
    const afterRace = await roomState(room.host, room.roomCode);
    expect(afterRace.pauseReasons).toEqual([]);
    expect(await rejectionCodes(room)).not.toContain("E_PAUSED");
  });

  test("disconnect pause, credential rotation resume, and host grace removal recover correctly", async ({ browser }) => {
    const room = await createTwoPlayerRoom(browser, "Pause Alice", "Pause Bob");
    await startAndAcknowledge(room);
    const before = await roomState(room.host, room.roomCode);
    const activeSeat = before.round?.activePlayerId ?? before.seats[0]!.playerId;
    const activePage = displayName(before, activeSeat).includes("Bob") ? room.joiner : room.host;
    const observer = activePage === room.host ? room.joiner : room.host;

    await activePage.close();
    await expect(observer.getByRole("alert", { name: "Match paused" })).toBeVisible();
    const paused = await roomState(observer, room.roomCode);
    expect(paused.pauseReasons).toContain(activeSeat    );

    const resumedPage = await (activePage === room.host ? room.hostContext : room.joinContext).newPage();
    await resumeRoom(resumedPage, room.roomCode, room.origin);
    const resumed = await roomState(observer, room.roomCode);
    expect(resumed.pauseReasons).not.toContain(activeSeat);
    expect(resumed.seats.find((seat) => seat.playerId === activeSeat)?.sessionGeneration).toBeGreaterThan(
      before.seats.find((seat) => seat.playerId === activeSeat)?.sessionGeneration ?? -1,
    );

    await resumedPage.close();
    await advanceClock(observer, 120_000);
    await observer.getByRole("button", { name: new RegExp(`Remove ${displayName(resumed, activeSeat)}`) }).click();
    const removed = await roomState(observer, room.roomCode);
    expect(removed.seats.find((seat) => seat.playerId === activeSeat)?.connection).toBe("removed");
  });

  test("mid-snap restart recovery restores a paused room and resumes without duplicate actions", async ({ browser }) => {
    const port = 3220;
    const origin = `http://127.0.0.1:${port}`;
    const dbPath = resolve("e2e/.data/restart.sqlite");
    mkdirSync("e2e/.data", { recursive: true });
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });

    let serverProcess = await startServerProcess(port, dbPath);
    try {
      const room = await createTwoPlayerRoom(browser, "Restart Alice", "Restart Bob", origin);
      await startAndAcknowledge(room);
      const race = await driveToCorrectSnapWindow(room);
      const before = await roomState(room.host, room.roomCode);
      expect(before.round?.snapWindow?.windowId).toBe(race.snapWindowId);

      await room.host.close();
      await room.joiner.close();
      await stopServerProcess(serverProcess);
      serverProcess = await startServerProcess(port, dbPath);

      const host = await room.hostContext.newPage();
      const joiner = await room.joinContext.newPage();
      await resumeRoom(host, room.roomCode, room.origin);
      await resumeRoom(joiner, room.roomCode, room.origin);
      const recovered = await roomState(host, room.roomCode);
      expect(recovered.pauseReasons).toEqual([]);
      expect(recovered.round?.snapWindow?.windowId).toBe(race.snapWindowId);
      expect(recovered.round?.snapWindow?.generation).toBeGreaterThan(race.generation);

      await advanceClock(host, 2_000);
      const afterWindow = await roomState(host, room.roomCode);
      expect(afterWindow.round?.snapWindow).toBeNull();
    } finally {
      await stopServerProcess(serverProcess);
    }
  });
});

async function createTwoPlayerRoom(browser: Browser, hostName: string, joinerName: string, origin = ""): Promise<RoomPages> {
  const hostContext = await browser.newContext();
  const joinContext = await browser.newContext();
  const host = await hostContext.newPage();
  const joiner = await joinContext.newPage();

  await host.goto(urlFor(origin, "/?adapter=real&__e2e=1"));
  await host.getByLabel("Display name for new room").fill(hostName);
  await host.getByLabel("Rounds").fill("1");
  await host.getByLabel("Snap window seconds").fill("2");
  await host.getByLabel("Player cap").fill("2");
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host).toHaveURL(/\/room\//);
  const roomCode = host.url().match(/\/room\/([^/?#]+)/)?.[1];
  if (roomCode === undefined) {
    throw new Error("room code missing after create");
  }
  await ensureRoomConnected(host, roomCode);

  await joiner.goto(urlFor(origin, "/?adapter=real&__e2e=1"));
  await joiner.getByLabel("Room code").fill(roomCode);
  await joiner.getByLabel("Display name for joined room").fill(joinerName);
  await joiner.getByRole("button", { name: "Join room" }).click();
  await ensureRoomConnected(joiner, roomCode);
  await expect(host.getByText(joinerName)).toBeVisible();
  roomContexts.push(hostContext, joinContext);
  return { hostContext, joinContext, host, joiner, roomCode, origin };
}

async function startAndAcknowledge(room: RoomPages): Promise<void> {
  await room.host.getByRole("button", { name: "Start match" }).click();
  await expect(room.host.getByRole("heading", { name: "Game table", exact: true })).toBeVisible();
  let state = await roomState(room.host, room.roomCode);
  await room.host.getByRole("button", { name: "Acknowledge opening peek" }).click();
  await waitForRevision(room.host, room.roomCode, state.revision);
  state = await roomState(room.host, room.roomCode);
  await expect(room.joiner.getByRole("button", { name: "Acknowledge opening peek" })).toBeEnabled();
  await room.joiner.getByRole("button", { name: "Acknowledge opening peek" }).click();
  await waitForRevision(room.host, room.roomCode, state.revision);
}

async function driveMatchToCompletion(
  room: RoomPages,
  options: { readonly requirePower: boolean; readonly minimumTurnsBeforeCambio: number },
): Promise<{ readonly powerSeen: boolean; readonly snapWindowsSeen: number; readonly turns: number }> {
  let powerSeen = false;
  let snapWindowsSeen = 0;
  let turns = 0;
  let cambioCalled = false;

  for (let step = 0; step < 80; step += 1) {
    const state = await roomState(room.host, room.roomCode);
    if (state.status === "complete") {
      return { powerSeen, snapWindowsSeen, turns };
    }
    if (state.status === "intermission") {
      await clickIfEnabled(room.host, "Ready for next round");
      await clickIfEnabled(room.joiner, "Ready for next round");
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.pendingPower !== null && state.round?.pendingPower !== undefined) {
      powerSeen = true;
      await clickIfEnabled(pageForSeat(room, state, state.round.pendingPower.ownerId), "Skip power");
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.pendingTransfer !== null && state.round?.pendingTransfer !== undefined) {
      const page = pageForSeat(room, state, state.round.pendingTransfer.fromPlayerId);
      const slot = firstOccupiedSlot(state, state.round.pendingTransfer.fromPlayerId);
      await page.getByRole("button", { name: slotButtonName(state, state.round.pendingTransfer.fromPlayerId, slot, "Transfer this card") }).click();
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.snapWindow !== null && state.round?.snapWindow !== undefined) {
      snapWindowsSeen += 1;
      await advanceClock(room.host, 2_000);
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.turnStage === "turnStart" && state.round.activePlayerId !== null) {
      const page = pageForSeat(room, state, state.round.activePlayerId);
      if (!cambioCalled && turns >= options.minimumTurnsBeforeCambio && (!options.requirePower || powerSeen)) {
        await page.getByRole("button", { name: "Call Cambio" }).click();
        cambioCalled = true;
      } else {
        await page.getByRole("button", { name: "Draw card" }).click();
      }
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.turnStage === "drawn" && state.round.activePlayerId !== null) {
      await pageForSeat(room, state, state.round.activePlayerId).getByRole("button", { name: "Discard drawn card" }).click();
      turns += 1;
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
  }

  throw new Error("match did not complete");
}

async function driveToCorrectSnapWindow(room: RoomPages): Promise<{
  readonly snapWindowId: string;
  readonly generation: number;
  readonly targetPlayerId: string;
  readonly slotId: string;
}> {
  for (let step = 0; step < 80; step += 1) {
    const state = await roomState(room.host, room.roomCode);
    const window = state.round?.snapWindow;
    if (window !== null && window !== undefined) {
      const target = firstSlotWithRank(state, window.triggerRank);
      if (target !== null) {
        return {
          snapWindowId: window.windowId,
          generation: window.generation,
          targetPlayerId: target.playerId,
          slotId: target.slot.slotId,
        };
      }
      await advanceClock(room.host, 2_000);
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.pendingPower !== null && state.round?.pendingPower !== undefined) {
      await clickIfEnabled(pageForSeat(room, state, state.round.pendingPower.ownerId), "Skip power");
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.turnStage === "turnStart" && state.round.activePlayerId !== null) {
      await pageForSeat(room, state, state.round.activePlayerId).getByRole("button", { name: "Draw card" }).click();
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
    if (state.round?.turnStage === "drawn" && state.round.activePlayerId !== null) {
      await pageForSeat(room, state, state.round.activePlayerId).getByRole("button", { name: "Discard drawn card" }).click();
      await waitForRevision(room.host, room.roomCode, state.revision);
      continue;
    }
  }
  throw new Error("no correct snap target reached");
}

async function resumeRoom(page: Page, roomCode: string, origin = ""): Promise<void> {
  await page.goto(urlFor(origin, `/room/${roomCode}`));
  await page.getByRole("button", { name: new RegExp(`Resume room ${roomCode}`) }).click();
  await waitForClientConnected(page, roomCode);
}

async function ensureRoomConnected(page: Page, roomCode: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/room/${roomCode}$`));
  const connected = await waitForClientConnected(page, roomCode, { status: "lobby", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!connected) {
    const resumeButton = page.getByRole("button", { name: new RegExp(`Resume room ${roomCode}`) });
    if (await resumeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await resumeButton.click();
    }
    await waitForClientConnected(page, roomCode, { status: "lobby", timeout: 8_000 });
  }
  await expect(page.getByRole("heading", { name: "Lobby", exact: true })).toBeVisible();
  const client = await clientState(page);
  const server = await roomState(page, roomCode);
  const viewerSeatId = client.snapshot?.viewerSeatId;
  expect(server.status).toBe("lobby");
  expect(server.seats.find((seat) => seat.playerId === viewerSeatId)?.connection).toBe("connected");
}

async function waitForClientConnected(
  page: Page,
  roomCode: string,
  options: {
    readonly status?: MatchState["status"];
    readonly phase?: NonNullable<MatchState["round"]>["phase"];
    readonly timeout?: number;
  } = {},
): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/room/${roomCode}$`), { timeout: options.timeout ?? 5_000 });
  await page.waitForFunction(
    ({ expectedStatus, expectedPhase }) => {
      const state = window.__cambioE2E?.getState();
      if (
        state === undefined ||
        state.connectionStatus !== "connected" ||
        state.snapshot === null
      ) {
        return false;
      }
      if (expectedStatus !== null && state.snapshot.room.status !== expectedStatus) {
        return false;
      }
      return expectedPhase === null || state.snapshot.round.phase === expectedPhase;
    },
    {
      expectedStatus: options.status ?? null,
      expectedPhase: options.phase ?? null,
    },
    { timeout: options.timeout ?? 5_000 },
  );
}

async function clientState(page: Page): Promise<ClientE2EState> {
  return await page.evaluate(() => {
    const state = window.__cambioE2E?.getState();
    if (state === undefined) {
      throw new Error("Cambio E2E hook is unavailable");
    }
    return state;
  });
}

async function sendClientCommand(page: Page, type: string, payload: unknown): Promise<void> {
  await page.evaluate(({ commandType, commandPayload }) => {
    const hook = window.__cambioE2E;
    if (hook === undefined || hook.getState().connectionStatus !== "connected") {
      throw new Error("Cambio E2E hook is not connected");
    }
    hook.sendCommand(commandType, commandPayload);
  }, { commandType: type, commandPayload: payload });
}

async function rejectionCodes(room: RoomPages): Promise<string[]> {
  return [
    ...Object.keys((await clientState(room.host)).rejections),
    ...Object.keys((await clientState(room.joiner)).rejections),
  ];
}

async function roomState(page: Page, roomCode: string): Promise<MatchState> {
  const response = await page.request.get(new URL(`/__test/rooms/${roomCode}/state`, page.url()).toString());
  expect(response.ok()).toBe(true);
  return await response.json() as MatchState;
}

async function advanceClock(page: Page, ms: number): Promise<void> {
  const response = await page.request.post(new URL("/__test/clock/advance", page.url()).toString(), { data: { ms } });
  expect(response.ok()).toBe(true);
}

async function waitForRevision(page: Page, roomCode: string, revision: number): Promise<void> {
  await expect.poll(async () => (await roomState(page, roomCode)).revision, { timeout: 4_000 }).toBeGreaterThan(revision);
}

async function clickIfEnabled(page: Page, name: string): Promise<boolean> {
  const button = page.getByRole("button", { name });
  await expect(button).toBeEnabled({ timeout: 4_000 });
  await button.click();
  return true;
}

function pageForSeat(room: RoomPages, state: MatchState, seatId: string): Page {
  return state.seats.find((seat) => seat.playerId === seatId)?.seatIndex === 0 ? room.host : room.joiner;
}

function firstOccupiedSlot(state: MatchState, playerId: string): CardSlot {
  const slot = state.round?.slotsByPlayer[playerId]?.find((candidate) => candidate.cardId !== null);
  if (slot === undefined) {
    throw new Error(`no occupied slot for ${playerId}`);
  }
  return slot;
}

function firstSlotWithRank(state: MatchState, rank: string): { readonly playerId: string; readonly slot: CardSlot } | null {
  const slotsByPlayer = state.round?.slotsByPlayer ?? {};
  for (const [playerId, slots] of Object.entries(slotsByPlayer)) {
    for (const slot of slots) {
      if (slot.cardId !== null && state.round?.cards[slot.cardId]?.rank === rank) {
        return { playerId, slot };
      }
    }
  }
  return null;
}

function slotButtonName(state: MatchState, playerId: string, slot: CardSlot, action: string): RegExp {
  return new RegExp(`${slotLabel(slot)} .* for ${escapeRegex(displayName(state, playerId))}.*${escapeRegex(action)}`, "i");
}

function slotLabel(slot: CardSlot): string {
  switch (slot.position) {
    case "topLeft":
      return "top left";
    case "topRight":
      return "top right";
    case "bottomLeft":
      return "bottom left";
    case "bottomRight":
      return "bottom right";
    case null:
      return "penalty";
  }
}

function displayName(state: MatchState, playerId: string): string {
  return state.seats.find((seat) => seat.playerId === playerId)?.displayName ?? playerId;
}

function winnersFromScores(state: MatchState): readonly string[] {
  const entries = Object.entries(state.cumulativeScores);
  const lowest = Math.min(...entries.map(([, score]) => score));
  return entries.filter(([, score]) => score === lowest).map(([playerId]) => playerId);
}

async function expectNoHiddenOpponentCardsInDom(page: Page, state: MatchState): Promise<void> {
  const viewer = state.seats.find((seat) => page.url().includes("/room/"))?.playerId ?? state.seats[0]?.playerId;
  const hiddenCards = new Set<string>();
  for (const [playerId, slots] of Object.entries(state.round?.slotsByPlayer ?? {})) {
    if (playerId === viewer) {
      continue;
    }
    for (const slot of slots) {
      const card = slot.cardId === null ? null : state.round?.cards[slot.cardId];
      if (card !== null && card !== undefined) {
        hiddenCards.add(formatCard(card));
      }
    }
  }

  const text = await page.locator("body").evaluate((body) => [
    body.textContent ?? "",
    ...Array.from(body.querySelectorAll("[aria-label]"), (element) => element.getAttribute("aria-label") ?? ""),
  ].join("\n").toLowerCase());
  for (const card of hiddenCards) {
    expect(text).not.toContain(card.toLowerCase());
  }
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
}

function formatCard(card: { readonly rank: string; readonly suit: string | null }): string {
  if (card.rank === "JOKER") {
    return "Joker";
  }
  return `${rankLabel(card.rank)} of ${card.suit}`;
}

function rankLabel(rank: string): string {
  switch (rank) {
    case "A":
      return "Ace";
    case "J":
      return "Jack";
    case "Q":
      return "Queen";
    case "K":
      return "King";
    default:
      return rank;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function urlFor(origin: string, path: string): string {
  return origin.length === 0 ? path : new URL(path, origin).toString();
}

async function startServerProcess(port: number, dbPath: string): Promise<ChildProcess> {
  const child = spawn("pnpm", ["--filter", "@cambio/server", "start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CAMBIO_TEST_MODE: "1",
      CAMBIO_PORT: String(port),
      CAMBIO_SQLITE_PATH: dbPath,
    },
    stdio: "ignore",
  });
  await expect.poll(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      return response.ok;
    } catch {
      return false;
    }
  }, { timeout: 20_000 }).toBe(true);
  return child;
}

async function stopServerProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(resolveStop, 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}
