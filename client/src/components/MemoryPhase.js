import React, { useState } from 'react';
import Card from './Card';
import './MemoryPhase.css';

function MemoryPhase({ cards, gameState, myPlayerId, onDone }) {
  const [showingCards, setShowingCards] = useState(true);

  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  const memoryCardsData = cards.map(idx => myPlayer.cards[idx]);

  return (
    <div className="memory-phase-overlay">
      <div className="memory-phase-modal">
        <h2>Memorize Your Cards!</h2>
        <p>Look at your 2 closest cards and try to remember them.</p>

        <div className="memory-cards-display">
          {memoryCardsData.map((card, idx) => (
            <Card key={idx} card={card} faceUp={true} />
          ))}
        </div>

        <button onClick={() => {
          setShowingCards(false);
          onDone();
        }} className="done-btn">
          Done Looking
        </button>
      </div>
    </div>
  );
}

export default MemoryPhase;
