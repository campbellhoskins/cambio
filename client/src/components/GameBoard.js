import React, { useState, useEffect, useContext } from 'react';
import { SocketContext } from '../contexts/SocketContext';
import Card from './Card';
import DiscardPile from './DiscardPile';
import Notification from './Notification';
import MemoryPhase from './MemoryPhase';
import EndGameScreen from './EndGameScreen';
import './GameBoard.css';

function GameBoard({ roomCode }) {
  const socket = useContext(SocketContext);
  const [gameState, setGameState] = useState(null);
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [drawnCard, setDrawnCard] = useState(null);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showMemoryPhase, setShowMemoryPhase] = useState(false);
  const [memoryCards, setMemoryCards] = useState([]);
  const [lookingAtCard, setLookingAtCard] = useState(null);
  const [abilityState, setAbilityState] = useState(null);
  const [stickingWindowActive, setStickingWindowActive] = useState(false);
  const [stickingTimeLeft, setStickingTimeLeft] = useState(0);

  useEffect(() => {
    if (!socket) return;

    socket.on('GAME_STATE_UPDATE', (state) => {
      setGameState(state);
      setMyPlayerId(socket.id);

      const currentPlayer = state.players.find(p => p.id === socket.id);
      setIsMyTurn(state.currentTurn === socket.id);
    });

    socket.on('MEMORY_PHASE', ({ cardIndexes }) => {
      setMemoryCards(cardIndexes);
      setShowMemoryPhase(true);
    });

    socket.on('CARD_DRAWN', ({ card }) => {
      setDrawnCard(card);
    });

    socket.on('TURN_CHANGED', ({ currentTurn }) => {
      setIsMyTurn(currentTurn === socket.id);
      setDrawnCard(null);
      setAbilityState(null);
    });

    socket.on('CARD_REVEALED', ({ playerId, cardIndex, card, duration }) => {
      setLookingAtCard({ playerId, cardIndex, card });
      setTimeout(() => setLookingAtCard(null), duration || 3000);
    });

    socket.on('STICKING_WINDOW_OPENED', ({ timeLeft }) => {
      setStickingWindowActive(true);
      setStickingTimeLeft(timeLeft);
    });

    socket.on('STICKING_WINDOW_CLOSED', () => {
      setStickingWindowActive(false);
    });

    socket.on('NOTIFICATION', ({ message, type }) => {
      addNotification(message, type);
    });

    socket.on('GAME_ENDED', ({ finalState }) => {
      setGameState(finalState);
    });

    return () => {
      socket.off('GAME_STATE_UPDATE');
      socket.off('MEMORY_PHASE');
      socket.off('CARD_DRAWN');
      socket.off('TURN_CHANGED');
      socket.off('CARD_REVEALED');
      socket.off('STICKING_WINDOW_OPENED');
      socket.off('STICKING_WINDOW_CLOSED');
      socket.off('NOTIFICATION');
      socket.off('GAME_ENDED');
    };
  }, [socket]);

  useEffect(() => {
    if (stickingWindowActive && stickingTimeLeft > 0) {
      const timer = setTimeout(() => {
        setStickingTimeLeft(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [stickingWindowActive, stickingTimeLeft]);

  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  const drawCard = () => {
    if (isMyTurn && !drawnCard) {
      socket.emit('DRAW_CARD', { roomCode });
    }
  };

  const swapCard = (cardIndex) => {
    if (drawnCard) {
      socket.emit('SWAP_CARD', { roomCode, cardIndex });
      setDrawnCard(null);
    }
  };

  const discardDrawnCard = () => {
    if (drawnCard) {
      socket.emit('DISCARD_CARD', { roomCode });
      setDrawnCard(null);
    }
  };

  const useAbility = () => {
    if (drawnCard && hasAbility(drawnCard)) {
      setAbilityState({ card: drawnCard, step: 1 });
    }
  };

  const handleAbilityCardSelect = (playerId, cardIndex) => {
    if (!abilityState) return;

    const cardValue = abilityState.card.value;

    // 7 or 8: Look at own card
    if ((cardValue === '7' || cardValue === '8') && playerId === myPlayerId) {
      socket.emit('USE_ABILITY', {
        roomCode,
        abilityType: 'LOOK_OWN',
        cardIndex
      });
      setAbilityState(null);
      setDrawnCard(null);
    }
    // 9 or 10: Look at opponent's card
    else if ((cardValue === '9' || cardValue === '10') && playerId !== myPlayerId) {
      socket.emit('USE_ABILITY', {
        roomCode,
        abilityType: 'LOOK_OPPONENT',
        targetPlayerId: playerId,
        cardIndex
      });
      setAbilityState(null);
      setDrawnCard(null);
    }
    // J or Q: Blind switch (two step)
    else if (cardValue === 'J' || cardValue === 'Q') {
      if (abilityState.step === 1) {
        setAbilityState({
          ...abilityState,
          step: 2,
          firstCard: { playerId, cardIndex }
        });
      } else if (abilityState.step === 2) {
        socket.emit('USE_ABILITY', {
          roomCode,
          abilityType: 'BLIND_SWITCH',
          firstCard: abilityState.firstCard,
          secondCard: { playerId, cardIndex }
        });
        setAbilityState(null);
        setDrawnCard(null);
      }
    }
    // Black King: Look and switch (two step)
    else if (cardValue === 'K' && (abilityState.card.suit === 'spades' || abilityState.card.suit === 'clubs')) {
      if (abilityState.step === 1) {
        socket.emit('USE_ABILITY', {
          roomCode,
          abilityType: 'LOOK_ANY',
          targetPlayerId: playerId,
          cardIndex
        });
        setAbilityState({ ...abilityState, step: 2, lookCard: { playerId, cardIndex } });
      } else if (abilityState.step === 2 && playerId === myPlayerId) {
        socket.emit('USE_ABILITY', {
          roomCode,
          abilityType: 'SWITCH_AFTER_LOOK',
          lookCard: abilityState.lookCard,
          swapCard: { playerId, cardIndex }
        });
        setAbilityState(null);
        setDrawnCard(null);
      }
    }
  };

  const callCambio = () => {
    if (isMyTurn && !drawnCard) {
      if (window.confirm('Are you sure you want to call Cambio? You cannot play a card this turn.')) {
        socket.emit('CALL_CAMBIO', { roomCode });
      }
    }
  };

  const hasAbility = (card) => {
    if (!card) return false;
    const value = card.value;
    if (['7', '8', '9', '10', 'J', 'Q'].includes(value)) return true;
    if (value === 'K' && (card.suit === 'spades' || card.suit === 'clubs')) return true;
    return false;
  };

  const handleStick = (playerId, cardIndex) => {
    if (stickingWindowActive) {
      socket.emit('STICK_CARD', { roomCode, playerId, cardIndex });
    }
  };

  if (!gameState) {
    return <div className="loading">Loading game...</div>;
  }

  if (showMemoryPhase) {
    return (
      <MemoryPhase
        cards={memoryCards}
        gameState={gameState}
        myPlayerId={myPlayerId}
        onDone={() => {
          setShowMemoryPhase(false);
          socket.emit('MEMORY_PHASE_DONE', { roomCode });
        }}
      />
    );
  }

  if (gameState.phase === 'ENDED') {
    return <EndGameScreen gameState={gameState} roomCode={roomCode} socket={socket} />;
  }

  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  const otherPlayers = gameState.players.filter(p => p.id !== myPlayerId);

  return (
    <div className="game-board">
      <div className="game-header">
        <div className="room-code-header">Room: {roomCode}</div>
        <div className="turn-order">
          Turn Order: {gameState.turnOrder.map((pid, idx) => {
            const p = gameState.players.find(pl => pl.id === pid);
            return (
              <span key={pid} className={pid === gameState.currentTurn ? 'current-turn' : ''}>
                {p?.nickname}{idx < gameState.turnOrder.length - 1 ? ' → ' : ''}
              </span>
            );
          })}
        </div>
        {gameState.cambioCalledBy && (
          <div className="cambio-indicator">
            CAMBIO CALLED! Final turns: {gameState.finalTurnsRemaining}
          </div>
        )}
      </div>

      <div className="game-area">
        {/* Opponents */}
        <div className="opponents-area">
          {otherPlayers.map((player) => (
            <div key={player.id} className={`player-area opponent ${player.id === gameState.currentTurn ? 'active-turn' : ''}`}>
              <div className="player-name">{player.nickname}</div>
              <div className="player-cards">
                {player.cards.map((card, idx) => (
                  <Card
                    key={idx}
                    card={card}
                    faceUp={card.faceUp}
                    playerId={player.id}
                    cardIndex={idx}
                    onCardClick={() => handleAbilityCardSelect(player.id, idx)}
                    onStick={() => handleStick(player.id, idx)}
                    canClick={abilityState !== null}
                    canStick={stickingWindowActive}
                    isLooking={lookingAtCard?.playerId === player.id && lookingAtCard?.cardIndex === idx}
                    lookedCard={lookingAtCard?.playerId === player.id && lookingAtCard?.cardIndex === idx ? lookingAtCard.card : null}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Center - Deck and Discard */}
        <div className="center-area">
          <div
            className={`deck ${isMyTurn && !drawnCard ? 'clickable' : ''}`}
            onClick={drawCard}
          >
            <div className="card-back">🂠</div>
            <div className="deck-count">{gameState.deckCount} cards</div>
          </div>

          <DiscardPile
            topCard={gameState.discardPile[gameState.discardPile.length - 1]}
            canDrop={stickingWindowActive}
          />
        </div>

        {/* My cards */}
        {myPlayer && (
          <div className={`player-area my-area ${isMyTurn ? 'active-turn' : ''}`}>
            <div className="player-name">You ({myPlayer.nickname})</div>
            <div className="player-cards">
              {myPlayer.cards.map((card, idx) => (
                <Card
                  key={idx}
                  card={card}
                  faceUp={card.faceUp}
                  playerId={myPlayer.id}
                  cardIndex={idx}
                  onCardClick={() => {
                    if (drawnCard && !abilityState) {
                      swapCard(idx);
                    } else if (abilityState) {
                      handleAbilityCardSelect(myPlayer.id, idx);
                    }
                  }}
                  onStick={() => handleStick(myPlayer.id, idx)}
                  canClick={drawnCard || abilityState !== null}
                  canStick={stickingWindowActive}
                  isLooking={lookingAtCard?.playerId === myPlayer.id && lookingAtCard?.cardIndex === idx}
                  lookedCard={lookingAtCard?.playerId === myPlayer.id && lookingAtCard?.cardIndex === idx ? lookingAtCard.card : null}
                />
              ))}
            </div>

            {/* Action buttons */}
            {isMyTurn && (
              <div className="action-buttons">
                {!drawnCard && (
                  <button onClick={callCambio} className="cambio-btn">
                    Call Cambio
                  </button>
                )}

                {drawnCard && (
                  <div className="drawn-card-panel">
                    <div className="drawn-card-display">
                      <Card card={drawnCard} faceUp={true} />
                    </div>
                    <div className="drawn-card-actions">
                      {hasAbility(drawnCard) && (
                        <button onClick={useAbility}>Use Ability</button>
                      )}
                      <button onClick={discardDrawnCard}>Discard</button>
                    </div>
                  </div>
                )}

                {abilityState && (
                  <div className="ability-prompt">
                    {getAbilityPrompt(abilityState)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticking timer */}
      {stickingWindowActive && (
        <div className="sticking-timer">
          Sticking Window: {stickingTimeLeft}s
        </div>
      )}

      {/* Notifications */}
      <div className="notifications-container">
        {notifications.map(notif => (
          <Notification key={notif.id} message={notif.message} type={notif.type} />
        ))}
      </div>
    </div>
  );
}

function getAbilityPrompt(abilityState) {
  const card = abilityState.card;
  const step = abilityState.step;

  if (card.value === '7' || card.value === '8') {
    return 'Select one of your cards to look at';
  } else if (card.value === '9' || card.value === '10') {
    return 'Select an opponent\'s card to look at';
  } else if (card.value === 'J' || card.value === 'Q') {
    if (step === 1) return 'Select first card to switch';
    if (step === 2) return 'Select second card to switch';
  } else if (card.value === 'K' && (card.suit === 'spades' || card.suit === 'clubs')) {
    if (step === 1) return 'Select any card to look at';
    if (step === 2) return 'Select one of your cards to switch with';
  }

  return '';
}

export default GameBoard;
