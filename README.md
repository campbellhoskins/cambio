# Cambio - Multiplayer Card Game

A web-based multiplayer card game application that allows 2-4 players to play Cambio together in real-time.

## Features

- **Multiplayer Support**: 2-4 players per game room
- **Real-time Gameplay**: WebSocket-based communication using Socket.io
- **Complete Game Mechanics**:
  - Memory phase for initial card viewing
  - Card drawing and swapping
  - Special card abilities (7, 8, 9, 10, J, Q, Black King)
  - Drag-and-drop sticking system
  - 4-second sticking window
  - Call Cambio functionality
  - Scoring and winner determination
- **Responsive UI**: Built with React and styled components
- **Room System**: Create and join games with shareable room codes

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Install server dependencies:
```bash
cd server
npm install
```

2. Install client dependencies:
```bash
cd client
npm install
```

### Running the Application

1. Start the server (from the server directory):
```bash
npm start
```
The server will run on `http://localhost:3001`

2. Start the client (from the client directory):
```bash
npm start
```
The client will run on `http://localhost:3000`

### How to Play

1. **Create a Game**: Click "Create Game" on the homepage
2. **Share Room Code**: Copy and share the room link with friends
3. **Join Game**: Players enter their nicknames to join
4. **Start Game**: Host clicks "Start Game" when ready
5. **Memory Phase**: Each player views their 2 closest cards
6. **Play Turns**:
   - Draw a card from the deck
   - Either swap it with one of your cards, use a special ability, or discard
   - Other players can "stick" matching cards during the 4-second window
7. **Call Cambio**: When you think you have the lowest score, call Cambio before drawing
8. **Win**: Player with the lowest total score wins!

## Card Values

- **Ace**: 1 point
- **2-10**: Face value
- **Jack/Queen**: 10 points
- **Red King** (Hearts/Diamonds): 0 points
- **Black King** (Spades/Clubs): 10 points
- **Joker**: -1 point

## Special Card Abilities

- **7 or 8**: Look at one of your own cards
- **9 or 10**: Look at an opponent's card
- **Jack or Queen**: Blind switch any two cards
- **Black King**: Look at any card, then switch it with one of yours

## Technology Stack

### Frontend
- React.js
- React Router
- Socket.io Client
- React DnD (drag and drop)
- CSS3

### Backend
- Node.js
- Express.js
- Socket.io
- In-memory game state management

## Project Structure

```
cambio/
├── client/               # React frontend
│   ├── public/
│   └── src/
│       ├── components/   # React components
│       ├── contexts/     # React contexts
│       └── utils/        # Utility functions
└── server/              # Node.js backend
    ├── index.js         # Server entry point
    ├── gameManager.js   # Game logic
    └── utils.js         # Utility functions
```

## Development

The application is built using modern JavaScript and follows best practices for React and Node.js development.

## License

ISC
