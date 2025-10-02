import React, { useState, useEffect, useContext, useRef } from 'react';
import { SocketContext } from '../contexts/SocketContext';
import Card from './Card';
import DiscardPile from './DiscardPile';
import Notification from './Notification';
import MemoryPhase from './MemoryPhase';
import EndGameScreen from './EndGameScreen';
import FloatingCard from './FloatingCard';
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
  const [stackingMode, setStackingMode] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [floatingCards, setFloatingCards] = useState([]);
  const [givingCardMode, setGivingCardMode] = useState(null); // { targetPlayerId: string }
  const discardPileRef = useRef(null);
  const cardRefs = useRef({});

  useEffect(() => {
    if (!socket) {
      console.log('GameBoard: No socket yet');
      return;
    }

    console.log('GameBoard: Socket connected, setting up listeners');

    // Request current game state when component mounts
    socket.emit('REQUEST_GAME_STATE', { roomCode });

    socket.on('GAME_STATE_UPDATE', (state) => {
      console.log('GameBoard: Received GAME_STATE_UPDATE', state);
      console.log('Player cards arrays:');
      state.players.forEach(p => {
        console.log(`  ${p.nickname}: [${p.cards.map((c, i) => c ? `${i}:${c.value}` : `${i}:null`).join(', ')}] (length: ${p.cards.length})`);
      });
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
      setSwapMode(false);
      setStackingMode(false);
    });

    socket.on('CARD_REVEALED', ({ playerId, cardIndex, card, duration }) => {
      setLookingAtCard({ playerId, cardIndex, card });
      setTimeout(() => setLookingAtCard(null), duration || 3000);
    });


    socket.on('NOTIFICATION', ({ message, type }) => {
      addNotification(message, type);
    });

    socket.on('GAME_ENDED', ({ finalState }) => {
      setGameState(finalState);
    });

    socket.on('STACK_SUCCESS_GIVE_CARD', ({ targetPlayerId, targetPlayerNickname }) => {
      console.log('STACK_SUCCESS_GIVE_CARD received:', { targetPlayerId, targetPlayerNickname });
      setGivingCardMode({ targetPlayerId, targetPlayerNickname });
      setStackingMode(false);
    });

    return () => {
      socket.off('GAME_STATE_UPDATE');
      socket.off('MEMORY_PHASE');
      socket.off('CARD_DRAWN');
      socket.off('TURN_CHANGED');
      socket.off('CARD_REVEALED');
      socket.off('NOTIFICATION');
      socket.off('GAME_ENDED');
      socket.off('STACK_SUCCESS_GIVE_CARD');
    };
  }, [socket]);


  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  };

  const animateCardToDiscard = (card, sourceElement) => {
    if (!sourceElement || !discardPileRef.current) {
      return;
    }

    const sourceRect = sourceElement.getBoundingClientRect();
    const destRect = discardPileRef.current.getBoundingClientRect();

    // Center the card on the discard pile
    const cardWidth = 80; // Card width from CSS
    const cardHeight = 112; // Card height from CSS

    const floatingCard = {
      id: Date.now(),
      card,
      startPos: {
        x: sourceRect.left,
        y: sourceRect.top
      },
      endPos: {
        x: destRect.left + (destRect.width - cardWidth) / 2,
        y: destRect.top + (destRect.height - cardHeight) / 2
      }
    };

    // Use a ref to track floating cards so they persist across re-renders
    setFloatingCards(prev => {
      // Don't add if already exists (prevents duplicates on re-render)
      const exists = prev.some(fc => fc.id === floatingCard.id);
      if (exists) return prev;
      return [...prev, floatingCard];
    });

    setTimeout(() => {
      setFloatingCards(prev => prev.filter(fc => fc.id !== floatingCard.id));
    }, 850);
  };

  const drawCard = () => {
    if (isMyTurn && !drawnCard) {
      socket.emit('DRAW_CARD', { roomCode });
    }
  };

  const swapCard = (cardIndex) => {
    if (drawnCard && swapMode && gameState) {
      const myPlayer = gameState.players.find(p => p.id === myPlayerId);
      if (myPlayer && myPlayer.cards[cardIndex]) {
        const cardToSwap = myPlayer.cards[cardIndex];
        const sourceElement = cardRefs.current[`${myPlayerId}-${cardIndex}`];

        if (sourceElement && discardPileRef.current) {
          animateCardToDiscard(cardToSwap, sourceElement);
        }
      }

      socket.emit('SWAP_CARD', { roomCode, cardIndex });
      setDrawnCard(null);
      setSwapMode(false);
    }
  };

  const initiateSwap = () => {
    setSwapMode(true);
  };

  const discardDrawnCard = () => {
    if (drawnCard) {
      // Get the drawn card display element
      const drawnCardElement = document.querySelector('.drawn-card-display');

      if (drawnCardElement) {
        animateCardToDiscard(drawnCard, drawnCardElement);
      }

      socket.emit('DISCARD_CARD', { roomCode });
      setDrawnCard(null);
      setSwapMode(false);
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

  const handleStack = (playerId, cardIndex) => {
    if (stackingMode) {
      const player = gameState.players.find(p => p.id === playerId);
      const cardToStack = player.cards[cardIndex];
      const sourceElement = cardRefs.current[`${playerId}-${cardIndex}`];

      if (sourceElement) {
        animateCardToDiscard(cardToStack, sourceElement);
      }

      socket.emit('STICK_CARD', { roomCode, playerId, cardIndex });
      setStackingMode(false);
    }
  };

  const initiateStack = () => {
    setStackingMode(true);
  };

  const giveCard = (cardIndex) => {
    if (givingCardMode) {
      console.log('giveCard called with cardIndex:', cardIndex, 'targetPlayerId:', givingCardMode.targetPlayerId);
      socket.emit('GIVE_CARD_AFTER_STACK', {
        roomCode,
        targetPlayerId: givingCardMode.targetPlayerId,
        cardIndex
      });
      setGivingCardMode(null);
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
                  <div key={idx} ref={el => cardRefs.current[`${player.id}-${idx}`] = el}>
                    <Card
                      card={card}
                      faceUp={true}
                      playerId={player.id}
                      cardIndex={idx}
                      onCardClick={() => {
                        if (abilityState) {
                          handleAbilityCardSelect(player.id, idx);
                        } else if (stackingMode) {
                          handleStack(player.id, idx);
                        }
                      }}
                      canClick={abilityState !== null || stackingMode}
                      isPulsing={stackingMode}
                      pulseColor="orange"
                      isLooking={lookingAtCard?.playerId === player.id && lookingAtCard?.cardIndex === idx}
                      lookedCard={lookingAtCard?.playerId === player.id && lookingAtCard?.cardIndex === idx ? lookingAtCard.card : null}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Center - Deck and Discard */}
        <div className="center-area">
          <div
            className={`deck ${isMyTurn && !drawnCard ? 'clickable pulsing' : ''}`}
            onClick={drawCard}
          >
            <div className="card-back">🂠</div>
            <div className="deck-count">{gameState.deckCount} cards</div>
          </div>

          <div ref={discardPileRef}>
            <DiscardPile
              discardPile={gameState.discardPile}
            />
          </div>

          {!stackingMode && (gameState.phase === 'PLAYING' || gameState.phase === 'MEMORY') && (
            <button className="stack-btn" onClick={initiateStack}>
              STACK
            </button>
          )}
        </div>

        {/* My cards */}
        {myPlayer && (
          <div className={`player-area my-area ${isMyTurn ? 'active-turn' : ''}`}>
            <div className="player-name">You ({myPlayer.nickname})</div>
            {isMyTurn && !drawnCard && (
              <div className="turn-prompt">Your turn. Pick a card</div>
            )}
            <div className="player-cards">
              {myPlayer.cards.map((card, idx) => (
                <div key={idx} ref={el => cardRefs.current[`${myPlayer.id}-${idx}`] = el}>
                  <Card
                    card={card}
                    faceUp={true}
                    playerId={myPlayer.id}
                    cardIndex={idx}
                    onCardClick={() => {
                      if (swapMode) {
                        swapCard(idx);
                      } else if (abilityState) {
                        handleAbilityCardSelect(myPlayer.id, idx);
                      } else if (stackingMode) {
                        handleStack(myPlayer.id, idx);
                      } else if (givingCardMode) {
                        giveCard(idx);
                      }
                    }}
                    canClick={swapMode || abilityState !== null || stackingMode || givingCardMode !== null}
                    isPulsing={swapMode || stackingMode || givingCardMode !== null}
                    pulseColor={givingCardMode ? 'green' : 'orange'}
                    isLooking={lookingAtCard?.playerId === myPlayer.id && lookingAtCard?.cardIndex === idx}
                    lookedCard={lookingAtCard?.playerId === myPlayer.id && lookingAtCard?.cardIndex === idx ? lookingAtCard.card : null}
                  />
                </div>
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
                    {swapMode && (
                      <div className="swap-prompt">Select a card to swap</div>
                    )}
                    <div className="drawn-card-actions">
                      {hasAbility(drawnCard) && (
                        <button onClick={useAbility}>Use Ability</button>
                      )}
                      <button onClick={initiateSwap}>Swap</button>
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

      {/* Stacking prompt */}
      {stackingMode && (
        <div className="stacking-prompt">
          Select a card to stack on the pile
        </div>
      )}

      {/* Giving card prompt */}
      {givingCardMode && (
        <div className="giving-card-prompt">
          Select one of your cards to replace {givingCardMode.targetPlayerNickname}'s card
        </div>
      )}

      {/* Notifications */}
      <div className="notifications-container">
        {notifications.map(notif => (
          <Notification key={notif.id} message={notif.message} type={notif.type} />
        ))}
      </div>

      {/* Floating Cards */}
      {floatingCards.map(fc => (
        <FloatingCard
          key={fc.id}
          card={fc.card}
          startPos={fc.startPos}
          endPos={fc.endPos}
          onComplete={() => {}}
        />
      ))}
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
