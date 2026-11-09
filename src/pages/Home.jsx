import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const DISPLAY_NAME_KEY = 'rave-display-name';

function createRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function Home() {
  const navigate = useNavigate();
  const initialName = useMemo(() => {
    if (typeof window === 'undefined') {
      return 'Guest';
    }

    return localStorage.getItem(DISPLAY_NAME_KEY) || 'Guest';
  }, []);

  const [displayName, setDisplayName] = useState(initialName);
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  const saveName = (name) => {
    const trimmed = name.trim();
    const nextName = trimmed || 'Guest';
    localStorage.setItem(DISPLAY_NAME_KEY, nextName);
    return nextName;
  };

  const handleCreateRoom = () => {
    const nextName = saveName(displayName);
    const roomId = createRoomId();
    localStorage.setItem(DISPLAY_NAME_KEY, nextName);
    navigate(`/room/${roomId}`);
  };

  const handleJoinRoom = () => {
    const nextName = saveName(displayName);
    const code = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

    if (!code) {
      setError('Enter a room code to join.');
      return;
    }

    localStorage.setItem(DISPLAY_NAME_KEY, nextName);
    setError('');
    navigate(`/room/${code}`);
  };

  return (
    <div className="app-shell home-page">
      <div className="home-card">
        <h1 className="logo">Rave</h1>
        <p className="subtitle">Sync video, chat, and voice in one room.</p>

        <div className="form-stack">
          <label className="input-label">
            Display name
            <input
              className="text-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={30}
              placeholder="Your name"
            />
          </label>

          <label className="input-label">
            Room code
            <input
              className="text-input"
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
              maxLength={6}
              placeholder="ABC123"
            />
          </label>

          {error ? <div className="error-box">{error}</div> : null}

          <div className="button-row">
            <button type="button" className="primary-btn" onClick={handleCreateRoom}>
              Create room
            </button>
            <button type="button" className="secondary-btn" onClick={handleJoinRoom}>
              Join room
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
