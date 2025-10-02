import React, { useState, useEffect, useContext } from 'react';
import { useParams } from 'react-router-dom';
import { SocketContext } from '../contexts/SocketContext';
import GameBoard from './GameBoard';
import './GameLobby.css';

function GameLobby() {
  const { roomCode } = useParams();
  const socket = useContext(SocketContext);
  const [nickname, setNickname] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [isCreator, setIsCreator] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!socket) {
      console.log('GameLobby: No socket yet');
      return;
    }

    console.log('GameLobby: Setting up socket listeners for room:', roomCode);

    socket.on('PLAYER_JOINED', ({ players }) => {
      console.log('GameLobby: PLAYER_JOINED', players);
      setPlayers(players);
    });

    socket.on('PLAYER_LEFT', ({ players }) => {
      console.log('GameLobby: PLAYER_LEFT', players);
      setPlayers(players);
    });

    socket.on('GAME_STARTED', () => {
      console.log('GameLobby: GAME_STARTED received');
      setGameStarted(true);
    });

    socket.on('ERROR', ({ message }) => {
      console.log('GameLobby: ERROR', message);
      setError(message);
    });

    return () => {
      socket.off('PLAYER_JOINED');
      socket.off('PLAYER_LEFT');
      socket.off('GAME_STARTED');
      socket.off('ERROR');
    };
  }, [socket]);

  const joinRoom = () => {
    if (nickname.trim().length < 2 || nickname.trim().length > 15) {
      setError('Nickname must be 2-15 characters');
      return;
    }

    socket.emit('JOIN_ROOM', { roomCode, nickname: nickname.trim() });

    socket.once('ROOM_JOINED', ({ players, isCreator }) => {
      setHasJoined(true);
      setPlayers(players);
      setIsCreator(isCreator);
      setError('');
    });

    socket.once('ERROR', ({ message }) => {
      setError(message);
    });
  };

  const startGame = () => {
    console.log('GameLobby: Starting game for room:', roomCode);
    socket.emit('START_GAME', { roomCode });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/game/${roomCode}`);
    alert('Link copied to clipboard!');
  };

  if (gameStarted) {
    return <GameBoard roomCode={roomCode} />;
  }

  if (!hasJoined) {
    return (
      <div className="lobby-container">
        <div className="join-modal">
          <h2>Join Game</h2>
          <p className="room-code-display">Room Code: {roomCode}</p>
          <input
            type="text"
            placeholder="Enter your nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
            maxLength={15}
          />
          {error && <p className="error-message">{error}</p>}
          <button onClick={joinRoom}>Join Game</button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-container">
      <div className="lobby-content">
        <h2>Game Lobby</h2>
        <div className="room-info">
          <p className="room-code-large">Room Code: {roomCode}</p>
          <button onClick={copyLink} className="copy-link-btn">Copy Link</button>
        </div>

        <div className="players-section">
          <h3>Players ({players.length}/4)</h3>
          <ul className="players-list">
            {players.map((player, index) => (
              <li key={player.id} className="player-item">
                <span className="player-number">{index + 1}.</span>
                <span className="player-name">{player.nickname}</span>
                {player.isCreator && <span className="creator-badge">Host</span>}
              </li>
            ))}
          </ul>
        </div>

        {isCreator && (
          <button
            onClick={startGame}
            disabled={players.length < 2}
            className="start-game-btn"
          >
            {players.length < 2 ? 'Waiting for players...' : 'Start Game'}
          </button>
        )}

        {!isCreator && (
          <p className="waiting-message">Waiting for host to start the game...</p>
        )}
      </div>
    </div>
  );
}

export default GameLobby;
