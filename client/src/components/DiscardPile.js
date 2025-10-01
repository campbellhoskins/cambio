import React from 'react';
import { useDrop } from 'react-dnd';
import Card from './Card';
import './DiscardPile.css';

function DiscardPile({ topCard, canDrop, onDrop }) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'CARD',
    drop: (item) => {
      if (onDrop) {
        onDrop(item);
      }
    },
    canDrop: () => canDrop,
    collect: (monitor) => ({
      isOver: monitor.isOver()
    })
  }), [canDrop, onDrop]);

  return (
    <div ref={drop} className={`discard-pile ${canDrop ? 'can-drop' : ''} ${isOver ? 'is-over' : ''}`}>
      {topCard ? (
        <Card card={topCard} faceUp={true} />
      ) : (
        <div className="empty-pile">Discard</div>
      )}
    </div>
  );
}

export default DiscardPile;
