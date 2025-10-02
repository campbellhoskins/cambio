# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cambio is a real-time multiplayer card game (2-4 players) built with React (frontend) and Node.js + Socket.io (backend). The game involves card drawing, swapping, special abilities, and a "sticking" mechanic where players can match cards during a 4-second window.

## Development Commands

### Running the Application

**Server (Terminal 1):**
```bash
cd server
npm start  # Runs on http://localhost:3001
```

**Client (Terminal 2):**
```bash
cd client
npm start  # Runs on http://localhost:3000
```

Both servers must be running simultaneously for the game to work.

### Managing Server Process

Kill server if port 3001 is in use:
```bash
pkill -f "node index.js"
```

Check if port is in use:
```bash
lsof -ti:3001
```

### Installation

```bash
# Server dependencies
cd server && npm install

# Client dependencies
cd client && npm install
```

## Architecture

### Client-Server Communication

**Event-Driven Architecture via Socket.io:**
- Client emits events → Server processes via GameManager → Server broadcasts updates to room
- All game state is managed server-side; clients receive sanitized state updates
- Socket rooms are used to scope events to specific games (identified by roomCode)

**Key Socket Events:**
- `CREATE_ROOM` / `JOIN_ROOM` / `START_GAME` - Lobby management
- `DRAW_CARD` / `SWAP_CARD` / `DISCARD_CARD` - Turn actions
- `USE_ABILITY` - Special card abilities (7, 8, 9, 10, J, Q, Black King)
- `STICK_CARD` - Matching cards during 4-second window
- `CALL_CAMBIO` - End-game trigger
- `REQUEST_GAME_STATE` - Client requests current state (important for component mounting)
- `GAME_STATE_UPDATE` - Server broadcasts state changes
- `MEMORY_PHASE` - Initial card viewing phase
- `STICKING_WINDOW_OPENED/CLOSED` - 4-second matching window timing

### Server Architecture

**`server/index.js`:**
- Express + Socket.io server setup
- Socket event handlers that delegate to GameManager
- Emits events to rooms using `io.to(roomCode).emit()`
- Individual player events use `io.to(player.id).emit()`

**`server/gameManager.js`:**
- Central game logic class
- Maintains `rooms` Map (roomCode → room object)
- Each room contains: players, gameState, phase
- Game state includes: deck, discardPile, currentTurn, turnOrder, cambioCalledBy
- All methods return sanitized game state (hides face-down cards properly)
- **Critical method:** `getGameState(roomCode)` - allows clients to request current state when mounting

**`server/utils.js`:**
- `generateRoomCode()` - Creates unique 8-char room codes (format: XXXX-XXXX)
- `createDeck()` - Standard 52 cards + 2 Jokers
- `shuffleDeck()` - Fisher-Yates shuffle

### Client Architecture

**Component Hierarchy:**
```
App (Socket.io connection + DnD provider)
├── HomePage (create game)
└── GameLobby (room joining, player list)
    └── GameBoard (main game UI - mounts after game starts)
        ├── MemoryPhase (modal for viewing initial cards)
        ├── Card (individual card with drag-and-drop)
        ├── DiscardPile (drop zone for sticking)
        ├── EndGameScreen (scoreboard)
        └── Notification (toast messages)
```

**Critical React Patterns:**

1. **Socket Context:** Socket instance is created in `App.js` and provided via `SocketContext` to all child components

2. **GameBoard Mounting Issue:** When `GameLobby` transitions to `GameBoard` after `GAME_STARTED` event, GameBoard mounts AFTER the initial `GAME_STATE_UPDATE` is broadcast. Solution: GameBoard calls `REQUEST_GAME_STATE` in its useEffect to fetch current state on mount.

3. **React StrictMode:** In development, components mount twice. Socket listeners may be set up twice (visible in console logs).

**State Management:**
- Game state is received via Socket.io events, stored in component state
- No Redux/global state - Socket events are the source of truth
- `gameState` object contains all players, cards, turn info, phase

### Game Flow

1. **Lobby Phase:** Room creation → Players join → Host starts game
2. **Memory Phase:** Each player views their bottom 2 cards (cardIndexes [0, 1])
3. **Playing Phase:** Turn-based gameplay with draw/swap/ability/discard actions
4. **Sticking Window:** 4-second timer after each discard where players can drag matching cards
5. **Cambio Called:** Triggers final round (each remaining player gets 1 turn)
6. **End Phase:** All cards revealed, scores calculated, winner determined

### Special Card Abilities Implementation

All abilities are handled via `USE_ABILITY` event with different `abilityType` values:
- `LOOK_OWN` (7, 8) - Reveals card temporarily to owner
- `LOOK_OPPONENT` (9, 10) - Reveals opponent's card to active player
- `BLIND_SWITCH` (J, Q) - Two-step card selection, swaps without revealing
- `LOOK_ANY` + `SWITCH_AFTER_LOOK` (Black King) - Two-step: look at any card, then swap with own

Server sends `CARD_REVEALED` event with duration (default 3000ms) for temporary reveals.

### Drag-and-Drop System

Uses `react-dnd` and `react-dnd-html5-backend`:
- Cards are draggable when `canStick={true}` (during sticking window)
- DiscardPile is a drop target when `canDrop={true}`
- Drag item contains `{ playerId, cardIndex }`
- Drop triggers `STICK_CARD` event with validation server-side

### Scoring

Card values (server calculates, client displays):
- Ace: 1, 2-10: face value, J/Q: 10
- Red King (♥♦): 0, Black King (♠♣): 10
- Joker: -1

Lowest score wins. Tie-breaking: non-Cambio caller wins, else compare individual card values.

## Common Debugging

**"Loading game..." stuck:**
- Check server logs for `GAME_STATE_UPDATE` emission
- Check client console for `GameBoard: Received GAME_STATE_UPDATE`
- Ensure `REQUEST_GAME_STATE` is being called when GameBoard mounts

**Socket connection issues:**
- Verify server is running on port 3001
- Check CORS settings in server/index.js
- Look for "Socket connected" log in browser console

**Port already in use:**
- Kill existing server: `pkill -f "node index.js"`
- Or change PORT in server code (update client SOCKET_URL accordingly)

## Important Implementation Details

- **In-memory state:** No database, all game state in server RAM (resets on server restart)
- **No authentication:** Players identified by socket.id, nicknames are display-only
- **Room expiry:** Rooms automatically deleted when all players disconnect
- **Card dealing:** 4 cards per player in 2×2 grid, first discard pile card drawn from deck
- **Turn order:** Randomized at game start, stored in `turnOrder` array
- **Final round:** Triggered by Cambio, tracks remaining turns in `finalTurnsRemaining`
