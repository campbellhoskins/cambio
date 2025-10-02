# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cambio is a real-time multiplayer card game (2-4 players) built with React (frontend) and Node.js + Socket.io (backend). The game involves card drawing, swapping, special abilities, and a "stacking" mechanic where players can match cards at any time with a visual button interface.

### ⚠️ CRITICAL GAME MECHANIC: Position-Based Memory System

**THE MOST IMPORTANT ASPECT OF CAMBIO:** Card positions MUST remain fixed throughout the game. Players rely on memory to track cards by their position in the 2x2 grid.

**NEVER use `.splice()`, `.filter()`, or any array methods that shift indices when removing cards.**

#### Core Rules for Position Preservation:

1. **Removing Cards**: ALWAYS replace with `null` at the exact index, NEVER splice
   ```javascript
   // ✅ CORRECT
   player.cards[cardIndex] = null;

   // ❌ WRONG - shifts all subsequent indices!
   player.cards.splice(cardIndex, 1);
   ```

2. **Swapping Cards**: Replace at the same index position
   ```javascript
   // ✅ CORRECT
   player.cards[cardIndex] = newCard;
   ```

3. **Array Length**: Card arrays ALWAYS remain length 4 (initial size) with `null` for removed cards
   - Player starts with [K♠, 3♥, 7♦, A♣] (length: 4)
   - After stacking position 2: [K♠, 3♥, null, A♣] (length: 4)
   - After stacking position 0: [null, 3♥, null, A♣] (length: 4)

4. **Grid Positions**: [0, 1] = top row, [2, 3] = bottom row - these indices NEVER change

5. **Adding Penalty Cards**: Only penalty cards use `.push()` to add NEW positions
   ```javascript
   // ✅ CORRECT - penalty adds new position
   player.cards.push(penaltyCard);
   ```

#### Common Mistakes to Avoid:

❌ **WRONG**: Using splice when stacking own card
```javascript
targetPlayer.cards.splice(cardIndex, 1); // NO! Shifts indices!
```

❌ **WRONG**: Using splice when giving card to opponent
```javascript
givingPlayer.cards.splice(cardIndex, 1)[0]; // NO! Shifts indices!
```

❌ **WRONG**: Filtering out null values
```javascript
player.cards.filter(c => c !== null); // NO! Destroys positions!
```

✅ **CORRECT**: Replace with null, preserve array length
```javascript
// Stacking own card
player.cards[cardIndex] = null;

// Giving card (two-step)
const cardToGive = player.cards[cardIndex];
player.cards[cardIndex] = null;  // Remove from giver
opponent.cards[targetIndex] = cardToGive;  // Place at exact position
```

#### Testing Position Preservation:

When testing card operations, verify:
- Array length remains constant (usually 4)
- Removed positions show `null` in logs
- Card indices don't shift when cards are removed
- Grid layout shows empty spaces (dashed placeholders) for null cards

**This is fundamental to gameplay - breaking position preservation breaks the entire memory mechanic and makes the game unplayable.**

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
- `STICK_CARD` - Stacking cards at any time (not limited to window)
- `GIVE_CARD_AFTER_STACK` - Exchange card after successfully stacking opponent's card
- `STACK_SUCCESS_GIVE_CARD` - Server notifies player to choose card to give
- `CALL_CAMBIO` - End-game trigger
- `REQUEST_GAME_STATE` - Client requests current state (important for component mounting)
- `GAME_STATE_UPDATE` - Server broadcasts state changes
- `MEMORY_PHASE` - Initial card viewing phase

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
App (Socket.io connection)
├── HomePage (create game)
└── GameLobby (room joining, player list)
    └── GameBoard (main game UI - mounts after game starts)
        ├── MemoryPhase (modal for viewing initial cards)
        ├── Card (individual card with click handlers)
        ├── DiscardPile (displays stacked cards with offset)
        ├── FloatingCard (animated card transitions)
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
2. **Memory Phase:** Each player views their bottom 2 cards (cardIndexes [2, 3] in 2x2 grid)
3. **Playing Phase:** Turn-based gameplay with draw/swap/ability/discard actions
4. **Stacking:** At any time, any player can click "STACK" button to match cards on discard pile
5. **Card Giving:** After successfully stacking opponent's card, player must give one of their cards
6. **Cambio Called:** Triggers final round (each remaining player gets 1 turn)
7. **End Phase:** All cards revealed, scores calculated, winner determined

### Special Card Abilities Implementation

All abilities are handled via `USE_ABILITY` event with different `abilityType` values:
- `LOOK_OWN` (7, 8) - Reveals card temporarily to owner
- `LOOK_OPPONENT` (9, 10) - Reveals opponent's card to active player
- `BLIND_SWITCH` (J, Q) - Two-step card selection, swaps without revealing
- `LOOK_ANY` + `SWITCH_AFTER_LOOK` (Black King) - Two-step: look at any card, then swap with own

Server sends `CARD_REVEALED` event with duration (default 3000ms) for temporary reveals.

### UI Interaction System

**Card Visibility:**
- All cards are visible to all players at all times (`faceUp={true}`)
- No hidden information except during temporary ability reveals

**Stacking System:**
- "STACK" button appears next to discard pile for all players
- Clicking triggers `stackingMode` - all cards pulse with orange border
- Selecting any card attempts to stack it on discard pile
- Server validates match and handles success/failure

**Card Swap System:**
- When drawing a card, player sees "Swap", "Use Ability", and "Discard" buttons
- "Swap" activates `swapMode` - player's cards pulse
- Prompt appears: "Select a card to swap"
- Selecting card swaps it with drawn card

**Card Giving After Stack:**
- After successfully stacking opponent's card, `givingCardMode` activates
- Player's cards pulse with green border
- Prompt: "Select one of your cards to replace [opponent]'s card"
- Selected card transfers to opponent's hand

**Floating Card Animations:**
- FloatingCard component handles all card-to-discard animations
- Uses refs to track source and destination positions
- 0.8s cubic-bezier transition with scale effect
- Applies to swap, discard, and stack actions

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

**Cards shifting positions / Array lengths changing:**
- **SYMPTOM**: Card arrays show length 3, 2, etc. instead of always 4
- **CAUSE**: Using `.splice()` or `.filter()` somewhere in the code
- **FIX**: Replace ALL card removal operations with `array[index] = null`
- **VERIFY**: Check browser console logs - arrays should always show `(length: 4)`
- **LOCATIONS TO CHECK**:
  - `stickCard()` method when removing own or opponent cards
  - `giveCardAfterStack()` method when transferring cards
  - Any ability methods that move cards
  - Client-side rendering (should NOT filter null values)

**Example fix:**
```javascript
// BEFORE (WRONG):
const cardToRemove = player.cards.splice(cardIndex, 1)[0]; // ❌ Shifts indices!

// AFTER (CORRECT):
const cardToRemove = player.cards[cardIndex];
player.cards[cardIndex] = null; // ✅ Preserves position
```

## Important Implementation Details

- **In-memory state:** No database, all game state in server RAM (resets on server restart)
- **No authentication:** Players identified by socket.id, nicknames are display-only
- **Room expiry:** Rooms automatically deleted when all players disconnect
- **Card dealing:** 4 cards per player in 2×2 grid (indices 0,1 = top row, 2,3 = bottom row)
- **Memory phase:** Players view bottom row cards (indices 2, 3)
- **Turn order:** Randomized at game start, stored in `turnOrder` array
- **Final round:** Triggered by Cambio, tracks remaining turns in `finalTurnsRemaining`
- **Card refs:** GameBoard maintains refs to all card DOM elements for animation positioning
- **Discard pile display:** Shows last 2 cards with offset (-10px, -10px) for visual matching
- **Position preservation:** Cards are replaced with `null` when removed, NEVER use `.splice()` to remove cards
- **Null cards:** Rendered as transparent placeholders with dashed borders to maintain grid layout

## Key Game Rules

**Stacking Mechanics:**
- Players can stack at ANY time (not turn-limited)
- Successfully stacking own card: card replaced with `null` at that position (preserves indices)
- Successfully stacking opponent's card:
  1. Opponent's card is added to discard pile
  2. Stacking player enters "giving card mode" (green pulsing cards)
  3. Stacking player selects one of their cards
  4. Selected card REPLACES opponent's card at the EXACT same index (critical for memory!)
  5. Stacking player's card position becomes `null`
- Failed stack: penalty card appended to stacking player's hand (new position)

**Turn Actions:**
- On your turn: Draw from deck → Choose to Swap with your card, Use Ability, or Discard
- "Your turn. Pick a card" prompt appears with pulsing deck
- Turn ends after action is completed

**Card Exchange Flow:**
1. Player stacks opponent's card successfully
2. Server emits `STACK_SUCCESS_GIVE_CARD` to stacking player
3. Client enters `givingCardMode` - cards pulse green
4. Player selects one of their cards
5. Client emits `GIVE_CARD_AFTER_STACK`
6. Server transfers card and updates game state
