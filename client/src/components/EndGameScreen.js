import React from 'react';
import Card from './Card';
import './EndGameScreen.css';

function EndGameScreen({ gameState, roomCode, socket }) {
  const calculateScore = (cards) => {
    return cards.reduce((total, card) => {
      if (card.value === 'A') return total + 1;
      if (['J', 'Q'].includes(card.value)) return total + 10;
      if (card.value === 'K') {
        // Red kings = 0, Black kings = 10
        return total + (card.suit === 'hearts' || card.suit === 'diamonds' ? 0 : 10);
      }
      if (card.value === 'Joker') return total - 1;
      return total + parseInt(card.value);
    }, 0);
  };

  const playersWithScores = gameState.players.map(player => ({
    ...player,
    score: calculateScore(player.cards)
  })).sort((a, b) => a.score - b.score);

  const winner = playersWithScores[0];

  const playAgain = () => {
    socket.emit('PLAY_AGAIN', { roomCode });
  };

  const leaveGame = () => {
    window.location.href = '/';
  };

  return (
    <div className="end-game-screen">
      <div className="end-game-modal">
        <h1>Game Over!</h1>

        <div className="winner-announcement">
          🏆 {winner.nickname} wins with {winner.score} points! 🏆
        </div>

        <div className="scoreboard">
          {playersWithScores.map((player, rank) => (
            <div key={player.id} className={`player-score-row ${rank === 0 ? 'winner-row' : ''}`}>
              <div className="rank">#{rank + 1}</div>
              <div className="player-info">
                <div className="player-name">{player.nickname}</div>
                <div className="player-cards-display">
                  {player.cards.map((card, idx) => (
                    <Card key={idx} card={card} faceUp={true} />
                  ))}
                </div>
              </div>
              <div className="score">{player.score} pts</div>
            </div>
          ))}
        </div>

        <div className="end-game-actions">
          <button onClick={playAgain} className="play-again-btn">
            Play Again
          </button>
          <button onClick={leaveGame} className="leave-btn">
            Leave Game
          </button>
        </div>
      </div>
    </div>
  );
}

export default EndGameScreen;
