const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const GameManager = require('./gameManager');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const gameManager = new GameManager(io);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('CREATE_ROOM', () => {
    const roomCode = gameManager.createRoom(socket.id);
    socket.join(roomCode);
    socket.emit('ROOM_CREATED', { roomCode });
  });

  socket.on('JOIN_ROOM', ({ roomCode, nickname }) => {
    const result = gameManager.joinRoom(roomCode, socket.id, nickname);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      socket.join(roomCode);
      socket.emit('ROOM_JOINED', {
        players: result.players,
        isCreator: result.isCreator
      });
      io.to(roomCode).emit('PLAYER_JOINED', { players: result.players });
    }
  });

  socket.on('START_GAME', ({ roomCode }) => {
    console.log('START_GAME received for room:', roomCode, 'from:', socket.id);
    const result = gameManager.startGame(roomCode, socket.id);

    if (result.error) {
      console.log('START_GAME error:', result.error);
      socket.emit('ERROR', { message: result.error });
    } else {
      console.log('Game started successfully, emitting to room:', roomCode);
      console.log('Game state:', JSON.stringify(result.gameState, null, 2));

      io.to(roomCode).emit('GAME_STARTED');
      io.to(roomCode).emit('GAME_STATE_UPDATE', result.gameState);

      // Send memory phase to each player
      result.gameState.players.forEach(player => {
        console.log('Sending MEMORY_PHASE to player:', player.id);
        io.to(player.id).emit('MEMORY_PHASE', {
          cardIndexes: [2, 3] // Bottom row cards (grid positions: bottom-left, bottom-right)
        });
      });
    }
  });

  socket.on('REQUEST_GAME_STATE', ({ roomCode }) => {
    console.log('REQUEST_GAME_STATE for room:', roomCode, 'from:', socket.id);
    const gameState = gameManager.getGameState(roomCode);
    if (gameState) {
      console.log('Sending game state to:', socket.id);
      socket.emit('GAME_STATE_UPDATE', gameState);
    }
  });

  socket.on('MEMORY_PHASE_DONE', ({ roomCode }) => {
    gameManager.memoryPhaseDone(roomCode, socket.id);
  });

  socket.on('DRAW_CARD', ({ roomCode }) => {
    const result = gameManager.drawCard(roomCode, socket.id);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      socket.emit('CARD_DRAWN', { card: result.card });
      io.to(roomCode).emit('NOTIFICATION', {
        message: `${result.playerNickname} drew a card`,
        type: 'info'
      });
    }
  });

  socket.on('SWAP_CARD', ({ roomCode, cardIndex }) => {
    const result = gameManager.swapCard(roomCode, socket.id, cardIndex);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      io.to(roomCode).emit('GAME_STATE_UPDATE', result.gameState);
      io.to(roomCode).emit('TURN_CHANGED', { currentTurn: result.gameState.currentTurn });
      io.to(roomCode).emit('NOTIFICATION', {
        message: `${result.playerNickname} swapped a card`,
        type: 'info'
      });

      // Open sticking window
      io.to(roomCode).emit('STICKING_WINDOW_OPENED', { timeLeft: 4 });

      setTimeout(() => {
        io.to(roomCode).emit('STICKING_WINDOW_CLOSED');
      }, 4000);
    }
  });

  socket.on('DISCARD_CARD', ({ roomCode }) => {
    const result = gameManager.discardCard(roomCode, socket.id);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      io.to(roomCode).emit('GAME_STATE_UPDATE', result.gameState);
      io.to(roomCode).emit('TURN_CHANGED', { currentTurn: result.gameState.currentTurn });
      io.to(roomCode).emit('NOTIFICATION', {
        message: `${result.playerNickname} discarded`,
        type: 'info'
      });

      // Open sticking window
      io.to(roomCode).emit('STICKING_WINDOW_OPENED', { timeLeft: 4 });

      setTimeout(() => {
        io.to(roomCode).emit('STICKING_WINDOW_CLOSED');
      }, 4000);
    }
  });

  socket.on('USE_ABILITY', (data) => {
    const result = gameManager.useAbility(data.roomCode, socket.id, data);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      if (result.revealCard) {
        io.to(socket.id).emit('CARD_REVEALED', result.revealCard);
      }

      if (result.gameState) {
        io.to(data.roomCode).emit('GAME_STATE_UPDATE', result.gameState);
      }

      if (result.notification) {
        io.to(data.roomCode).emit('NOTIFICATION', result.notification);
      }

      if (result.turnChanged) {
        io.to(data.roomCode).emit('TURN_CHANGED', { currentTurn: result.gameState.currentTurn });

        // Open sticking window
        io.to(data.roomCode).emit('STICKING_WINDOW_OPENED', { timeLeft: 4 });

        setTimeout(() => {
          io.to(data.roomCode).emit('STICKING_WINDOW_CLOSED');
        }, 4000);
      }
    }
  });

  socket.on('STICK_CARD', ({ roomCode, playerId, cardIndex }) => {
    const result = gameManager.stickCard(roomCode, socket.id, playerId, cardIndex);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      io.to(roomCode).emit('GAME_STATE_UPDATE', result.gameState);
      io.to(roomCode).emit('NOTIFICATION', result.notification);

      if (result.gameState.phase === 'ENDED') {
        io.to(roomCode).emit('GAME_ENDED', { finalState: result.gameState });
      }
    }
  });

  socket.on('CALL_CAMBIO', ({ roomCode }) => {
    const result = gameManager.callCambio(roomCode, socket.id);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      io.to(roomCode).emit('GAME_STATE_UPDATE', result.gameState);
      io.to(roomCode).emit('TURN_CHANGED', { currentTurn: result.gameState.currentTurn });
      io.to(roomCode).emit('NOTIFICATION', {
        message: `${result.playerNickname} called CAMBIO! Final round begins!`,
        type: 'error'
      });
    }
  });

  socket.on('PLAY_AGAIN', ({ roomCode }) => {
    const result = gameManager.resetGame(roomCode);

    if (result.error) {
      socket.emit('ERROR', { message: result.error });
    } else {
      io.to(roomCode).emit('GAME_STARTED');
      io.to(roomCode).emit('GAME_STATE_UPDATE', result.gameState);

      result.gameState.players.forEach(player => {
        io.to(player.id).emit('MEMORY_PHASE', {
          cardIndexes: [2, 3] // Bottom row cards
        });
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    gameManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Cambio server running on port ${PORT}`);
});
