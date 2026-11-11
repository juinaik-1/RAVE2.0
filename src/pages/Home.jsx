import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  MessageSquare,
  Play,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Badge, Button, Field, ThemeToggle, inputClass } from '../components/ui';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../context/AuthContext';
import { cn } from '../utils/cn';

const DISPLAY_NAME_KEY = 'Nook-display-name';

const features = [
  { icon: ShieldCheck, title: 'Private by default' },
  { icon: Zap, title: 'In-sync playback' },
  { icon: MessageSquare, title: 'Chat and voice' },
];

function createRoomId() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array(6);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export default function Home() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, loading, signOut } = useAuth();
  const initialName = useMemo(() => {
    if (typeof window === 'undefined') {
      return 'Guest';
    }

    return localStorage.getItem(DISPLAY_NAME_KEY) || 'Guest';
  }, []);

  const [displayName, setDisplayName] = useState(initialName);
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  // Use the signed-in account's name until the person types their own.
  useEffect(() => {
    if (!user?.name) return;
    if (!displayName || displayName === 'Guest') setDisplayName(user.name);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

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
    localStorage.setItem(`Nook-room-owner:${roomId}`, '1');
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

  const handleJoinSubmit = (event) => {
    event.preventDefault();
    handleJoinRoom();
  };

  const handleRoomCodeChange = (event) => {
    setRoomCode(event.target.value);
    if (error) {
      setError('');
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-[560px]" />

      <header className="relative z-10 border-b border-zinc-200/80 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-zinc-50 shadow-card dark:bg-zinc-100 dark:text-zinc-900">
              <Play className="h-3.5 w-3.5 fill-current" strokeWidth={2} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Nook
            </span>
            <Badge className="hidden sm:inline-flex">Beta</Badge>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:inline">{user?.email || 'Guest access'}</span>
            {user ? (
              <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => navigate('/signin')}>Sign in</Button>
            )}
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center px-4 py-10 sm:px-6 sm:py-16 lg:py-20">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center">
          <section className="mx-auto w-full max-w-[420px] lg:mx-0">
            <div className="inline-flex items-center gap-2 rounded-md border border-zinc-200/80 bg-white px-2.5 py-1 text-2xs font-medium text-zinc-600 shadow-card dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Rooms are live
            </div>

            <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
              Watch together,
              <br className="hidden sm:block" /> perfectly in sync.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base sm:leading-7">
              A private room for movies, YouTube, and the people you want to watch with. Share a
              link, press play, stay in sync.
            </p>

            <div className="mt-8 rounded-lg border border-zinc-200/80 bg-white p-6 shadow-card dark:border-zinc-800 dark:bg-zinc-900">
              <form onSubmit={handleJoinSubmit} className="flex flex-col gap-4" noValidate>
                <Field
                  label="Display name"
                  htmlFor="display-name"
                  hint="Shown to everyone in the room."
                >
                  <input
                    id="display-name"
                    className={inputClass}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={30}
                    placeholder="Your name"
                    autoComplete="nickname"
                  />
                </Field>

                <Button type="button" onClick={handleCreateRoom} className="w-full" disabled={loading}>
                  Create a room
                  <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                </Button>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <span className="w-full border-t border-zinc-200/80 dark:border-zinc-800" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-2 text-2xs font-medium uppercase tracking-[0.08em] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      or join a room
                    </span>
                  </div>
                </div>

                <Field label="Room code" htmlFor="room-code">
                  <div className="flex gap-2">
                    <input
                      id="room-code"
                      className={cn(inputClass, 'font-mono uppercase tracking-[0.18em]')}
                      value={roomCode}
                      onChange={handleRoomCodeChange}
                      maxLength={6}
                      placeholder="ABC123"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'room-code-error' : undefined}
                    />
                    <Button type="submit" variant="secondary" className="shrink-0">
                      Join
                      <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                  </div>
                </Field>

                {error ? (
                  <div
                    id="room-code-error"
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-red-200/80 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    <span>{error}</span>
                  </div>
                ) : null}
              </form>
            </div>

            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              {features.map(({ icon: Icon, title }) => (
                <li
                  key={title}
                  className="flex items-start gap-2 text-2xs leading-4 text-zinc-500 dark:text-zinc-400"
                >
                  <Icon
                    className="mt-px h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
                    strokeWidth={1.75}
                  />
                  <span>{title}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <footer className="relative z-10 pb-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <Link className="underline underline-offset-2" to="/privacy">Privacy policy</Link>
      </footer>
    </div>
  );
}
