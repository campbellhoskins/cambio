import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { SocketContext } from '../contexts/SocketContext';
import './HomePage.css';

function HomePage() {
  const socket = useContext(SocketContext);
  const navigate = useNavigate();

  const createGame = () => {
    if (socket) {
      socket.emit('CREATE_ROOM');
      socket.once('ROOM_CREATED', ({ roomCode }) => {
        navigate(`/game/${roomCode}`);
      });
    }
  };

  return (
    <div className="home-page">
      <div className="home-content">
        <h1 className="game-title">CAMBIO</h1>
        <p className="game-subtitle">Multiplayer Card Game</p>
        <button onClick={createGame} className="create-game-btn">
          Create Game
        </button>
      </div>
    </div>
  );
}

export default HomePage;
