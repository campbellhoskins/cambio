const { generateRoomCode, createDeck, shuffleDeck } = require('./utils');

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerRooms = new Map(); // Map player IDs to room codes
  }

  createRoom(creatorId) {
    const roomCode = generateRoomCode();
    this.rooms.set(roomCode, {
      code: roomCode,
      creator: creatorId,
      players: [],
      gameState: null,
      phase: 'LOBBY'
    });
    return roomCode;
  }

  joinRoom(roomCode, playerId, nickname) {
    const room = this.rooms.get(roomCode);

    if (!room) {
      return { error: 'Room not found' };
    }

    if (room.players.length >= 4) {
      return { error: 'Room is full' };
    }

    if (room.players.some(p => p.nickname === nickname)) {
      return { error: 'Nickname already taken' };
    }

    const player = {
      id: playerId,
      nickname,
      isCreator: playerId === room.creator
    };

    room.players.push(player);
    this.playerRooms.set(playerId, roomCode);

    return {
      players: room.players,
      isCreator: player.isCreator
    };
  }

  startGame(roomCode, playerId) {
    const room = this.rooms.get(roomCode);

    if (!room) {
      return { error: 'Room not found' };
    }

    if (playerId !== room.creator) {
      return { error: 'Only the creator can start the game' };
    }

    if (room.players.length < 2) {
      return { error: 'Need at least 2 players' };
    }

    // Initialize game state
    const deck = shuffleDeck(createDeck());
    const players = room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      cards: [],
      hasCalledCambio: false
    }));

    // Deal 4 cards to each player
    players.forEach(player => {
      player.cards = [
        { ...deck.pop(), faceUp: false },
        { ...deck.pop(), faceUp: false },
        { ...deck.pop(), faceUp: false },
        { ...deck.pop(), faceUp: false }
      ];
    });

    // First card on discard pile
    const discardPile = [deck.pop()];

    // Random turn order
    const turnOrder = [...players.map(p => p.id)].sort(() => Math.random() - 0.5);

    room.gameState = {
      phase: 'MEMORY',
      players,
      deck,
      discardPile,
      currentTurn: turnOrder[0],
      turnOrder,
      drawnCards: new Map(),
      cambioCalledBy: null,
      finalTurnsRemaining: 0,
      deckCount: deck.length,
      memoryPhaseDone: new Set()
    };

    room.phase = 'PLAYING';

    return { gameState: this.sanitizeGameState(room.gameState) };
  }

  memoryPhaseDone(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return;

    room.gameState.memoryPhaseDone.add(playerId);

    // Check if all players are done
    if (room.gameState.memoryPhaseDone.size === room.gameState.players.length) {
      room.gameState.phase = 'PLAYING';
      this.io.to(roomCode).emit('GAME_STATE_UPDATE', this.sanitizeGameState(room.gameState));
    }
  }

  drawCard(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) {
      return { error: 'Invalid game state' };
    }

    const gameState = room.gameState;

    if (gameState.currentTurn !== playerId) {
      return { error: 'Not your turn' };
    }

    if (gameState.drawnCards.has(playerId)) {
      return { error: 'Already drew a card' };
    }

    if (gameState.deck.length === 0) {
      // Reshuffle discard pile except top card
      const topCard = gameState.discardPile.pop();
      gameState.deck = shuffleDeck([...gameState.discardPile]);
      gameState.discardPile = [topCard];
    }

    const card = gameState.deck.pop();
    gameState.drawnCards.set(playerId, card);
    gameState.deckCount = gameState.deck.length;

    const player = gameState.players.find(p => p.id === playerId);

    return { card, playerNickname: player.nickname };
  }

  swapCard(roomCode, playerId, cardIndex) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) {
      return { error: 'Invalid game state' };
    }

    const gameState = room.gameState;
    const drawnCard = gameState.drawnCards.get(playerId);

    if (!drawnCard) {
      return { error: 'No card drawn' };
    }

    const player = gameState.players.find(p => p.id === playerId);
    const oldCard = player.cards[cardIndex];

    // Swap cards
    player.cards[cardIndex] = { ...drawnCard, faceUp: false };
    oldCard.faceUp = true;
    gameState.discardPile.push(oldCard);

    gameState.drawnCards.delete(playerId);

    // Next turn
    this.nextTurn(gameState);

    return {
      gameState: this.sanitizeGameState(gameState),
      playerNickname: player.nickname
    };
  }

  discardCard(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) {
      return { error: 'Invalid game state' };
    }

    const gameState = room.gameState;
    const drawnCard = gameState.drawnCards.get(playerId);

    if (!drawnCard) {
      return { error: 'No card drawn' };
    }

    const player = gameState.players.find(p => p.id === playerId);

    drawnCard.faceUp = true;
    gameState.discardPile.push(drawnCard);
    gameState.drawnCards.delete(playerId);

    // Next turn
    this.nextTurn(gameState);

    return {
      gameState: this.sanitizeGameState(gameState),
      playerNickname: player.nickname
    };
  }

  useAbility(roomCode, playerId, data) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) {
      return { error: 'Invalid game state' };
    }

    const gameState = room.gameState;
    const drawnCard = gameState.drawnCards.get(playerId);
    const player = gameState.players.find(p => p.id === playerId);

    if (!drawnCard) {
      return { error: 'No card drawn' };
    }

    let result = {};

    switch (data.abilityType) {
      case 'LOOK_OWN':
      case 'LOOK_OPPONENT':
      case 'LOOK_ANY': {
        const targetPlayer = gameState.players.find(p => p.id === (data.targetPlayerId || playerId));
        const card = targetPlayer.cards[data.cardIndex];

        result.revealCard = {
          playerId: targetPlayer.id,
          cardIndex: data.cardIndex,
          card,
          duration: 3000
        };

        result.notification = {
          message: `${player.nickname} used ${drawnCard.value} to look at a card`,
          type: 'info'
        };

        // If it's not a black king (which has a second step), end turn
        if (data.abilityType !== 'LOOK_ANY') {
          drawnCard.faceUp = true;
          gameState.discardPile.push(drawnCard);
          gameState.drawnCards.delete(playerId);
          this.nextTurn(gameState);
          result.turnChanged = true;
        }
        break;
      }

      case 'BLIND_SWITCH': {
        const player1 = gameState.players.find(p => p.id === data.firstCard.playerId);
        const player2 = gameState.players.find(p => p.id === data.secondCard.playerId);

        const temp = player1.cards[data.firstCard.cardIndex];
        player1.cards[data.firstCard.cardIndex] = player2.cards[data.secondCard.cardIndex];
        player2.cards[data.secondCard.cardIndex] = temp;

        result.notification = {
          message: `${player.nickname} switched two cards`,
          type: 'info'
        };

        drawnCard.faceUp = true;
        gameState.discardPile.push(drawnCard);
        gameState.drawnCards.delete(playerId);
        this.nextTurn(gameState);
        result.turnChanged = true;
        break;
      }

      case 'SWITCH_AFTER_LOOK': {
        const lookPlayer = gameState.players.find(p => p.id === data.lookCard.playerId);
        const swapPlayer = gameState.players.find(p => p.id === data.swapCard.playerId);

        const temp = lookPlayer.cards[data.lookCard.cardIndex];
        lookPlayer.cards[data.lookCard.cardIndex] = swapPlayer.cards[data.swapCard.cardIndex];
        swapPlayer.cards[data.swapCard.cardIndex] = temp;

        result.notification = {
          message: `${player.nickname} looked and switched cards`,
          type: 'info'
        };

        drawnCard.faceUp = true;
        gameState.discardPile.push(drawnCard);
        gameState.drawnCards.delete(playerId);
        this.nextTurn(gameState);
        result.turnChanged = true;
        break;
      }
    }

    result.gameState = this.sanitizeGameState(gameState);

    return result;
  }

  stickCard(roomCode, stickingPlayerId, targetPlayerId, cardIndex) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) {
      return { error: 'Invalid game state' };
    }

    const gameState = room.gameState;
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    const targetPlayer = gameState.players.find(p => p.id === targetPlayerId);
    const stickingPlayer = gameState.players.find(p => p.id === stickingPlayerId);
    const card = targetPlayer.cards[cardIndex];

    // Check if card matches
    if (card.value === topCard.value) {
      // Success!
      if (targetPlayerId === stickingPlayerId) {
        // Sticking own card
        targetPlayer.cards.splice(cardIndex, 1);

        // Check if player won
        if (targetPlayer.cards.length === 0) {
          gameState.phase = 'ENDED';
        }

        return {
          gameState: this.sanitizeGameState(gameState),
          notification: {
            message: `${stickingPlayer.nickname} successfully stuck their own card!`,
            type: 'success'
          }
        };
      } else {
        // Sticking opponent's card - need to give them a card
        // For simplicity, give them a random card from sticking player
        if (stickingPlayer.cards.length > 0) {
          const giveCardIndex = 0; // Give first card
          const cardToGive = stickingPlayer.cards.splice(giveCardIndex, 1)[0];
          targetPlayer.cards.push(cardToGive);
        }

        // Remove matched card
        targetPlayer.cards.splice(cardIndex, 1);

        return {
          gameState: this.sanitizeGameState(gameState),
          notification: {
            message: `${stickingPlayer.nickname} successfully stuck ${targetPlayer.nickname}'s card!`,
            type: 'success'
          }
        };
      }
    } else {
      // Failed - give penalty card
      if (gameState.deck.length > 0) {
        const penaltyCard = { ...gameState.deck.pop(), faceUp: false };
        stickingPlayer.cards.push(penaltyCard);
        gameState.deckCount = gameState.deck.length;
      }

      return {
        gameState: this.sanitizeGameState(gameState),
        notification: {
          message: `${stickingPlayer.nickname} stuck incorrectly! Penalty card added.`,
          type: 'error'
        }
      };
    }
  }

  callCambio(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) {
      return { error: 'Invalid game state' };
    }

    const gameState = room.gameState;

    if (gameState.currentTurn !== playerId) {
      return { error: 'Not your turn' };
    }

    if (gameState.drawnCards.has(playerId)) {
      return { error: 'Cannot call Cambio after drawing' };
    }

    const player = gameState.players.find(p => p.id === playerId);
    player.hasCalledCambio = true;

    gameState.cambioCalledBy = playerId;
    gameState.finalTurnsRemaining = gameState.players.length - 1;

    // Next turn
    this.nextTurn(gameState);

    return {
      gameState: this.sanitizeGameState(gameState),
      playerNickname: player.nickname
    };
  }

  nextTurn(gameState) {
    const currentIndex = gameState.turnOrder.indexOf(gameState.currentTurn);
    const nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
    gameState.currentTurn = gameState.turnOrder[nextIndex];

    if (gameState.cambioCalledBy) {
      gameState.finalTurnsRemaining--;

      if (gameState.finalTurnsRemaining <= 0) {
        this.endGame(gameState);
      }
    }
  }

  endGame(gameState) {
    gameState.phase = 'ENDED';

    // Reveal all cards
    gameState.players.forEach(player => {
      player.cards.forEach(card => {
        card.faceUp = true;
      });
    });
  }

  resetGame(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { error: 'Room not found' };
    }

    // Reset and start new game
    const deck = shuffleDeck(createDeck());
    const players = room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      cards: [],
      hasCalledCambio: false
    }));

    players.forEach(player => {
      player.cards = [
        { ...deck.pop(), faceUp: false },
        { ...deck.pop(), faceUp: false },
        { ...deck.pop(), faceUp: false },
        { ...deck.pop(), faceUp: false }
      ];
    });

    const discardPile = [deck.pop()];
    const turnOrder = [...players.map(p => p.id)].sort(() => Math.random() - 0.5);

    room.gameState = {
      phase: 'MEMORY',
      players,
      deck,
      discardPile,
      currentTurn: turnOrder[0],
      turnOrder,
      drawnCards: new Map(),
      cambioCalledBy: null,
      finalTurnsRemaining: 0,
      deckCount: deck.length,
      memoryPhaseDone: new Set()
    };

    return { gameState: this.sanitizeGameState(room.gameState) };
  }

  handleDisconnect(playerId) {
    const roomCode = this.playerRooms.get(playerId);
    if (roomCode) {
      const room = this.rooms.get(roomCode);
      if (room) {
        room.players = room.players.filter(p => p.id !== playerId);
        this.io.to(roomCode).emit('PLAYER_LEFT', { players: room.players });

        if (room.players.length === 0) {
          this.rooms.delete(roomCode);
        }
      }
      this.playerRooms.delete(playerId);
    }
  }

  sanitizeGameState(gameState) {
    return {
      phase: gameState.phase,
      players: gameState.players.map(p => ({
        id: p.id,
        nickname: p.nickname,
        cards: p.cards,
        hasCalledCambio: p.hasCalledCambio
      })),
      discardPile: gameState.discardPile,
      currentTurn: gameState.currentTurn,
      turnOrder: gameState.turnOrder,
      cambioCalledBy: gameState.cambioCalledBy,
      finalTurnsRemaining: gameState.finalTurnsRemaining,
      deckCount: gameState.deckCount
    };
  }
}

module.exports = GameManager;
