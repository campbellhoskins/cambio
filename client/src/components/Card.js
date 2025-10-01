import React from 'react';
import { useDrag } from 'react-dnd';
import './Card.css';

const SUITS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

function Card({ card, faceUp, playerId, cardIndex, onCardClick, onStick, canClick, canStick, isLooking, lookedCard }) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: 'CARD',
    item: { playerId, cardIndex },
    canDrag: canStick && !faceUp,
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  }), [canStick, faceUp, playerId, cardIndex]);

  const displayCard = faceUp ? card : (isLooking && lookedCard ? lookedCard : null);
  const isRed = card && (card.suit === 'hearts' || card.suit === 'diamonds');

  if (!card) return null;

  return (
    <div
      ref={drag}
      className={`playing-card ${faceUp ? 'face-up' : 'face-down'} ${canClick ? 'clickable' : ''} ${isDragging ? 'dragging' : ''} ${isLooking ? 'looking' : ''}`}
      onClick={onCardClick}
      style={{ opacity: isDragging ? 0.5 : 1 }}
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
