import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  Copy,
  LogOut,
  Play,
  RefreshCw,
  Users,
} from 'lucide-react';
import Chat from '../components/Chat';
import DriveSource from '../components/DriveSource';
import UserList from '../components/UserList';
import VideoPlayer from '../components/VideoPlayer';
import VoicePanel from '../components/VoicePanel';
import { Badge, Button, Switch, ThemeToggle } from '../components/ui';
import { useChat } from '../hooks/useChat';
import { useAuth } from '../context/AuthContext';
import { useRoomChannel } from '../hooks/useRoomChannel';
import { useTheme } from '../hooks/useTheme';
import { useVideoSync } from '../hooks/useVideoSync';
import { useVoice } from '../hooks/useVoice';
import { cn } from '../utils/cn';

const DISPLAY_NAME_KEY = 'Nook-display-name';

export default function Room() {
  const navigate = useNavigate();
  const location = useLocation();
  const { roomId } = useParams();
  const { theme, toggleTheme } = useTheme();
  const { signOut, user } = useAuth();
  const roomKey = (roomId || '').trim().toUpperCase();
  const isRoomOwner = typeof window !== 'undefined'
    && localStorage.getItem(`Nook-room-owner:${roomKey}`) === '1';
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

  // Use the signed-in account's name until the person chooses their own display name.
  useEffect(() => {
    if (!user?.name) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(DISPLAY_NAME_KEY) : '';
    if (!stored || stored === 'Guest') setDisplayName(user.name);
  }, [user]);

  useEffect(() => {
    if (!/^[A-Z0-9]{4,6}$/.test(roomKey)) {
      navigate('/');
    }
  }, [roomKey, navigate]);

  const { channel, presenceUsers, hostId, isConnected, connectionStatus, send, updatePresence, transferHost, userId } = useRoomChannel(
    roomKey,
    displayName,
    isRoomOwner,
  );

  const isHost = hostId === userId;
  const canControl = !hostOnlyControls || isHost;

  useEffect(() => {
    // The host owns the toggle and updates presence itself. Letting presence
    // sync write back would clobber an optimistic toggle with a stale value,
    // so only non-host viewers follow the host's presence payload.
    if (isHost) return;
    const hostPresence = presenceUsers.find((participant) => participant.userId === hostId);
    if (hostPresence) setHostOnlyControls(Boolean(hostPresence.hostOnlyControls));
  }, [hostId, presenceUsers, isHost]);

  const changeHostOnlyControls = (value) => {
    setHostOnlyControls(value);
    if (isHost) updatePresence({ hostOnlyControls: value });
  };

  const video = useVideoSync({
    roomId: roomKey,
    channel,
    isHost,
    canControl,
    send,
    hostOnlyControls,
    hostId,
    userId,
  });

  useEffect(() => {
    if (isConnected) video.requestState();
  }, [isConnected, video.requestState]);

  useEffect(() => {
    const sharedStream = location.state?.streamId;
    if (sharedStream) {
      void video.loadStream({ streamId: sharedStream, name: location.state.name });
      navigate(`/room/${roomKey}`, { replace: true, state: null });
    }
  }, [location.key, location.state, navigate, roomKey, video.loadStream]);

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
  const previousPresenceRoomRef = useRef(roomKey);

  useEffect(() => {
    if (previousPresenceRoomRef.current !== roomKey) {
      previousPresenceRoomRef.current = roomKey;
      previousPresenceRef.current = [];
      return;
    }
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
  }, [presenceUsers, chat.addSystemMessage, roomKey]);

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

  const copySucceeded = copyStatus.startsWith('Invite link copied');
  const peopleLabel = presenceUsers.length === 1 ? 'person' : 'people';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900">
              <Play className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
            </span>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="shrink-0 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Room
                </h1>
                <Badge className="font-mono tracking-[0.14em]">{roomKey}</Badge>
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full sm:hidden',
                    isConnected ? 'bg-emerald-500' : 'bg-amber-500',
                  )}
                  title={isConnected ? 'Connected to the room' : 'Connecting to the room'}
                />
              </div>
              <p className="hidden items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 sm:flex">
                <Users className="h-3 w-3" strokeWidth={1.75} />
                {presenceUsers.length} {peopleLabel}
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                {isHost ? 'You are the host' : 'Host controls playback'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span
              className="hidden sm:inline-flex"
              title={isConnected ? 'Connected to the room' : 'Connecting to the room'}
            >
              <Badge tone={connectionStatus === 'connected' ? 'success' : connectionStatus === 'error' ? 'danger' : 'warning'} dot>
                {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'error' ? 'Connection issue' : 'Connecting'}
              </Badge>
            </span>

            <Button
              variant="secondary"
              size="sm"
              onClick={copyInviteLink}
              aria-label="Copy invite link"
            >
              {copySucceeded ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              <span className="hidden sm:inline">{copySucceeded ? 'Copied' : 'Copy invite'}</span>
            </Button>

            <ThemeToggle theme={theme} onToggle={toggleTheme} />

            <Button variant="ghost" size="sm" onClick={leaveRoom} aria-label="Leave room">
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Leave</span>
            </Button>

            {user ? (
              <Button variant="ghost" size="sm" onClick={() => { signOut(); navigate('/'); }} aria-label="Sign out">
                Sign out
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => navigate('/signin')} aria-label="Sign in">
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            <VideoPlayer
              url={video.url}
              streamId={video.streamId}
              streamName={video.streamName}
              playing={video.playing}
              time={video.time}
              roomTime={video.roomTime}
              duration={video.duration}
              canControl={canControl}
              canConvert={Boolean(user)}
              isHost={isHost}
              loading={video.loading}
              error={video.error}
              syncNonce={video.syncNonce}
              onPlayPause={video.handlePlayPause}
              onSeek={video.handleSeek}
              onProgress={video.handleProgress}
              onDuration={video.handleDuration}
              onLoadVideo={video.loadVideo}
              onReady={video.handleReady}
              onVideoError={video.handleVideoError}
            />

            {user ? (
              <DriveSource
                onLoadStream={video.loadStream}
                onConvert={(stream) => navigate('/convert', {
                  state: { streamId: stream.streamId, name: stream.name, roomId: roomKey },
                })}
              />
            ) : (
              <p className="rounded-md border border-zinc-200/80 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                Guest mode: you can watch, chat, and join voice. Sign in to use Drive or convert videos.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200/80 bg-white px-3 py-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              {isHost ? (
                <Switch
                  id="host-only-controls"
                  checked={hostOnlyControls}
                  onChange={(event) => changeHostOnlyControls(event.target.checked)}
                  label="Host-only controls"
                />
              ) : <span className="text-xs text-zinc-500">{hostOnlyControls ? 'Host-only playback controls' : 'Everyone can control playback'}</span>}
              <Button variant="secondary" size="sm" onClick={video.requestState}>
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                Request sync
              </Button>
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
              onTransferHost={(targetUserId) => transferHost(targetUserId, hostOnlyControls)}
              speakingUsers={voice.remoteUsers.map((user) => user.userId).filter(Boolean)}
              isConnected={isConnected}
              connectionStatus={connectionStatus}
            />
          </div>

          <Chat
            messages={chat.messages}
            onSendMessage={chat.sendMessage}
            currentUserId={userId}
            displayName={displayName}
            className="h-[560px] min-h-[420px] lg:sticky lg:top-[72px] lg:h-[calc(100vh-88px)]"
          />
        </div>
      </main>

      {copyStatus ? (
        <div
          role="status"
          className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-sm items-start gap-2 rounded-md border border-zinc-200/80 bg-white px-3 py-2.5 text-xs leading-5 text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 sm:left-auto sm:right-6 sm:mx-0"
        >
          {copySucceeded ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2} />
          ) : (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={1.75} />
          )}
          <span className="min-w-0 break-words">{copyStatus}</span>
        </div>
      ) : null}
    </div>
  );
}
