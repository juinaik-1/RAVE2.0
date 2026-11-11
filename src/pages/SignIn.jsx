import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertCircle, Play, ShieldCheck } from 'lucide-react';
import { Button, Panel } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';

export default function SignIn() {
  const { user, loading, signIn } = useAuth();
  const { theme } = useTheme();
  const buttonRef = useRef(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (loading || user || !import.meta.env.VITE_GOOGLE_CLIENT_ID) return undefined;
    let attempts = 0;
    const setup = () => {
      const google = window.google?.accounts?.id;
      if (google && buttonRef.current) {
        google.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: async ({ credential }) => {
            setPending(true);
            setError('');
            try {
              await signIn(credential);
            } catch (requestError) {
              setError(requestError.message || 'Google sign-in failed.');
            } finally {
              setPending(false);
            }
          },
        });
        google.renderButton(buttonRef.current, {
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'signin_with',
          width: 320,
        });
        return true;
      }
      return false;
    };
    if (!setup()) {
      const timer = window.setInterval(() => {
        attempts += 1;
        if (setup() || attempts >= 40) window.clearInterval(timer);
      }, 250);
      return () => {
        window.clearInterval(timer);
      };
    }
    return undefined;
  }, [loading, user, signIn, theme]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">Loading…</main>;
  }
  if (user) return <Navigate to="/" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <Panel className="w-full max-w-md p-7">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Play className="h-3.5 w-3.5 fill-current" />
          </span>
          Nook
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Sign in to Nook</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Sign in with an approved Google account to create a room and connect your own Drive videos.
        </p>
        <div className="mt-6 min-h-11">
          <div ref={buttonRef} className={pending ? 'pointer-events-none opacity-50' : ''} />
          {pending ? <p className="mt-2 text-xs text-zinc-500">Checking your account…</p> : null}
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Only email addresses on the Nook allowlist can sign in.
        </div>
        {error ? (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}
        {!import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
          <p role="alert" className="mt-4 text-xs text-red-600">Google sign-in is not configured.</p>
        ) : null}
        <p className="mt-5 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Want to join a room as a guest? <Link className="underline underline-offset-2" to="/">Enter a room code</Link>.
        </p>
        <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
          <Link className="underline underline-offset-2" to="/privacy">Privacy policy</Link>
        </p>
      </Panel>
    </main>
  );
}
