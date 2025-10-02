import React from 'react';
import './Card.css';

const SUITS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

function Card({ card, faceUp, playerId, cardIndex, onCardClick, canClick, isPulsing, pulseColor, isLooking, lookedCard }) {

  // Handle null cards (removed/stacked cards - preserve position)
  if (!card) return <div className="playing-card-placeholder" />;

  const displayCard = faceUp ? card : (isLooking && lookedCard ? lookedCard : null);
  const isRed = card && (card.suit === 'hearts' || card.suit === 'diamonds');

  const pulseClass = isPulsing ? (pulseColor === 'green' ? 'pulsing-green' : 'pulsing') : '';

  return (
    <div
      className={`playing-card ${faceUp ? 'face-up' : 'face-down'} ${canClick ? 'clickable' : ''} ${pulseClass} ${isLooking ? 'looking' : ''}`}
      onClick={onCardClick}
    >
      {displayCard ? (
        <div className={`card-content ${isRed ? 'red' : 'black'}`}>
          <div className="card-value">{displayCard.value}</div>
          <div className="card-suit">{SUITS[displayCard.suit]}</div>
        </div>
      ) : (
        <div className="card-back-design">🂠</div>
      )}
    </div>
  );
}

export default Card;
