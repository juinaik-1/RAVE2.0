import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Chat from '../components/Chat';
import UserList from '../components/UserList';
import VideoPlayer from '../components/VideoPlayer';
import VoicePanel from '../components/VoicePanel';
import { useChat } from '../hooks/useChat';
import { useRoomChannel } from '../hooks/useRoomChannel';
import { useVideoSync } from '../hooks/useVideoSync';
import { useVoice } from '../hooks/useVoice';

const DISPLAY_NAME_KEY = 'rave-display-name';

export default function Room() {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const roomKey = (roomId || '').trim().toUpperCase();
  const storedName =
    typeof window !== 'undefined' ? localStorage.getItem(DISPLAY_NAME_KEY) || 'Guest' : 'Guest';
  const [displayName, setDisplayName] = useState(storedName);
  const [hostOnlyControls, setHostOnlyControls] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISPLAY_NAME_KEY, displayName || 'Guest');
    }
  }, [displayName]);

  useEffect(() => {
    if (!roomKey) {
      navigate('/');
    }
  }, [roomKey, navigate]);

  const { channel, presenceUsers, hostId, isConnected, send, updatePresence, userId } = useRoomChannel(
    roomKey,
    displayName,
  );

  const isHost = hostId === userId;
  const canControl = !hostOnlyControls || isHost;

  const video = useVideoSync({
    roomId: roomKey,
    channel,
    isHost,
    canControl,
    send,
  });

  const chat = useChat({ roomId: roomKey, channel, displayName, userId });
  const voice = useVoice({
    roomId: roomKey,
    channel,
    userId,
    displayName,
    presenceUsers,
    isConnected,
    updatePresence,
  });

  const previousPresenceRef = useRef([]);

  useEffect(() => {
    const previousMap = new Map(previousPresenceRef.current.map((item) => [item.userId, item]));
    const nextMap = new Map(presenceUsers.map((item) => [item.userId, item]));

    const joinedUsers = presenceUsers.filter((item) => !previousMap.has(item.userId));
    const leftUsers = previousPresenceRef.current.filter((item) => !nextMap.has(item.userId));

    joinedUsers.forEach((user) => {
      chat.addSystemMessage(`${user.name || 'Guest'} joined the room`);
    });

    leftUsers.forEach((user) => {
      chat.addSystemMessage(`${user.name || 'Guest'} left the room`);
    });

    previousPresenceRef.current = presenceUsers;
  }, [presenceUsers, chat]);

  const copyInviteLink = async () => {
    const inviteUrl = `${window.location.origin}/room/${roomKey}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus('Invite link copied');
    } catch (error) {
      setCopyStatus(`Copy failed. Share this manually: ${inviteUrl}`);
    }

    window.setTimeout(() => setCopyStatus(''), 2000);
  };

  const leaveRoom = () => {
    voice.leaveVoice();
    navigate('/');
  };

  return (
    <div className="app-shell room-shell">
      <header className="room-header">
        <div className="room-title">Room {roomKey}</div>

        <div className="header-actions">
          <div className="inline-badge">{isConnected ? 'Connected' : 'Connecting…'}</div>
          <button type="button" className="secondary-btn" onClick={copyInviteLink}>
            {copyStatus || 'Copy invite link'}
          </button>
          <button type="button" className="ghost-btn" onClick={leaveRoom}>
            Leave room
          </button>
        </div>
      </header>

      <div className="room-layout">
        <div className="main-column">
          <VideoPlayer
            url={video.url}
            playing={video.playing}
            time={video.time}
            canControl={canControl}
            isHost={isHost}
            loading={video.loading}
            error={video.error}
            onPlayPause={video.handlePlayPause}
            onSeek={video.handleSeek}
            onProgress={video.handleProgress}
            onDuration={video.handleDuration}
            onLoadVideo={video.loadVideo}
            onVideoError={video.handleVideoError}
          />

          <div className="status-row">
            <div className="switch-row">
              <label className="toggle" aria-label="Host only controls switch">
                <input
                  type="checkbox"
                  checked={hostOnlyControls}
                  onChange={() => setHostOnlyControls((current) => !current)}
                />
                <span className="toggle-track" />
                <span className="toggle-slider" />
              </label>
              <span>Host only controls</span>
            </div>

            <button type="button" className="ghost-btn" onClick={video.requestState}>
              Request sync
            </button>
          </div>

          <VoicePanel
            isJoined={voice.isJoined}
            isMuted={voice.isMuted}
            error={voice.error}
            remoteUsers={voice.remoteUsers}
            joinVoice={voice.joinVoice}
            leaveVoice={voice.leaveVoice}
            toggleMute={voice.toggleMute}
            setRemoteVolume={voice.setRemoteVolume}
          />

          <UserList
            users={presenceUsers}
            hostId={hostId}
            currentUserId={userId}
            speakingUsers={voice.remoteUsers.map((user) => user.userId).filter(Boolean)}
          />
        </div>

        <Chat
          messages={chat.messages}
          onSendMessage={chat.sendMessage}
          currentUserId={userId}
          displayName={displayName}
        />
      </div>
    </div>
  );
}
