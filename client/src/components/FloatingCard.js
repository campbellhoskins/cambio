import React, { useEffect, useState } from 'react';
import Card from './Card';
import './FloatingCard.css';

function FloatingCard({ card, startPos, endPos, onComplete }) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Trigger animation after a brief delay
    const timer = setTimeout(() => {
      setIsAnimating(true);
    }, 50);

    // Complete animation after duration
    const completeTimer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 850);

    return () => {
      clearTimeout(timer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  const currentPos = isAnimating ? endPos : startPos;

  return (
    <div
      className="floating-card"
      style={{
        left: `${currentPos.x}px`,
        top: `${currentPos.y}px`,
      }}
    >
      <Card card={card} faceUp={true} />
    </div>
  );
}

export default FloatingCard;
