import { useCallback, useRef, useState } from 'react';
import { api } from '../utils/api';

// Poll frequently so the progress bar and the handoff to the room feel
// immediate.
const POLL_DELAY_MS = 700;
const POLL_SLOW_MS = 1500;

export function useConversion() {
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const stopped = useRef(false);

  const poll = useCallback(async (jobId) => {
    let delay = POLL_DELAY_MS;
    while (!stopped.current) {
      let current = null;
      try {
        current = await api.get(`/api/jobs/${jobId}`);
      } catch (requestError) {
        // A transient failure shouldn't abandon the job; back off and retry.
        if (requestError.status && requestError.status < 500) throw requestError;
      }
      if (current) {
        setJob(current);
        if (['done', 'failed', 'cancelled', 'awaiting_options'].includes(current.status)) return current;
        // Slow down slightly during the long phases so the server is not
        // hammered, but stay responsive right after a status change.
        delay = current.status === 'converting' || current.status === 'downloading'
          ? POLL_SLOW_MS
          : POLL_DELAY_MS;
      }
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    return null;
  }, []);

  const start = useCallback(async (source, options = {}) => {
    stopped.current = false;
    setError('');
    setJob(null);
    try {
      const created = await api.post('/api/jobs', { ...source, ...options });
      setJob(created);
      await poll(created.id);
    } catch (requestError) {
      setError(requestError.message || 'Unable to start conversion.');
    }
  }, [poll]);

  const convert = useCallback(async (jobId, options) => {
    stopped.current = false;
    setError('');
    try {
      const updated = await api.post(`/api/jobs/${jobId}/convert`, options);
      setJob(updated);
      await poll(jobId);
    } catch (requestError) {
      setError(requestError.message || 'Unable to convert this video.');
    }
  }, [poll]);

  const cancel = useCallback(async () => {
    if (!job?.id) return;
    stopped.current = true;
    try {
      const cancelled = await api.delete(`/api/jobs/${job.id}`);
      setJob(cancelled);
    } catch (requestError) {
      setError(requestError.message || 'Unable to cancel conversion.');
    }
  }, [job]);

  return { job, error, start, convert, cancel };
}
