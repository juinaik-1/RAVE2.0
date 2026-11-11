import { useCallback, useRef, useState } from 'react';
import { api } from '../utils/api';

const POLL_DELAY_MS = 1500;

export function useConversion() {
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const stopped = useRef(false);

  const poll = useCallback(async (jobId) => {
    while (!stopped.current) {
      const current = await api.get(`/api/jobs/${jobId}`);
      setJob(current);
      if (['done', 'failed', 'cancelled', 'awaiting_options'].includes(current.status)) return current;
      await new Promise((resolve) => window.setTimeout(resolve, POLL_DELAY_MS));
    }
    return null;
  }, []);

  const start = useCallback(async (source) => {
    stopped.current = false;
    setError('');
    setJob(null);
    try {
      const created = await api.post('/api/jobs', source);
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
