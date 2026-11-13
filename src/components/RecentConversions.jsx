import { useCallback, useEffect, useState } from 'react';
import { Clock, Film, History } from 'lucide-react';
import { fetchMyStreams } from '../utils/api';
import { Badge, Button } from './ui';

// How long a converted video is kept by the server. The server owns the
// list, so the countdown only tells the user when to expect it to be gone.
function formatRemaining(expiresAt, now) {
  const remaining = Number(expiresAt || 0) - now;
  if (remaining <= 0) return 'Expiring now';
  const minutes = Math.round(remaining / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}

export default function RecentConversions({ onPlay }) {
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const result = await fetchMyStreams();
      setStreams(Array.isArray(result) ? result : []);
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load your recent conversions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the countdown honest without refetching the list.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // A conversion can be deleted by the server's cleanup while the room is
  // open, so the list is refreshed now and then.
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading) return null;
  if (error) {
    return (
      <section className="rounded-lg border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <History className="h-4 w-4" />
          <span>{error}</span>
        </div>
      </section>
    );
  }
  if (!streams.length) return null;

  return (
    <section className="rounded-lg border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 shrink-0 text-zinc-500" />
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Your recent conversions</h2>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Converted videos that are still on the server. They are removed when they expire.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {streams.map((stream) => (
          <li
            key={stream.streamId}
            className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200/80 px-2.5 py-2 text-xs dark:border-zinc-800"
          >
            <Film className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{stream.name}</span>
            <Badge tone="neutral" className="shrink-0">
              <Clock className="h-3 w-3" />
              {formatRemaining(stream.expiresAt, now)}
            </Badge>
            <Button size="sm" variant="secondary" onClick={() => onPlay?.(stream)}>
              Play in room
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
