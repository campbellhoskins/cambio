import React from 'react';
import Card from './Card';
import './DiscardPile.css';

function DiscardPile({ discardPile }) {
  if (!discardPile || discardPile.length === 0) {
    return (
      <div className="discard-pile">
        <div className="empty-pile">Discard</div>
      </div>
    );
  }

  // Show the last two cards with an offset
  const cardsToShow = discardPile.slice(-2);

  return (
    <div className="discard-pile">
      {cardsToShow.map((card, idx) => (
        <div
          key={idx}
          className="discard-card-wrapper"
          style={{
            position: idx === 0 && cardsToShow.length > 1 ? 'absolute' : 'relative',
            transform: idx === 0 && cardsToShow.length > 1 ? 'translate(-10px, -10px)' : 'none',
            zIndex: idx
          }}
        >
          <Card card={card} faceUp={true} />
        </div>
      ))}
    </div>
  );
}

export default DiscardPile;
