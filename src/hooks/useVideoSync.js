import { useEffect, useRef, useState } from 'react';

export function useVideoSync({ roomId, channel, isHost, canControl, send }) {
  const [videoUrl, setVideoUrl] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ignoreRemoteRef = useRef(false);
  const lastBroadcastRef = useRef(0);

  const broadcastState = (overrides = {}) => {
    if (!channel || !roomId) {
      return;
    }

    const payload = {
      roomId,
      url: overrides.url ?? videoUrl,
      time: Number(overrides.time ?? time),
      playing: Boolean(overrides.playing ?? playing),
      timestamp: Date.now(),
    };

    send('video:state', payload);
  };

  useEffect(() => {
    if (!channel || !roomId) {
      return;
    }

    const handleLoad = ({ payload }) => {
      if (!payload || payload.roomId !== roomId) {
        return;
      }

      ignoreRemoteRef.current = true;
      setVideoUrl(payload.url || '');
      setTime(Number(payload.time || 0));
      setPlaying(Boolean(payload.playing));
      setLoading(false);
      setError('');
      window.setTimeout(() => {
        ignoreRemoteRef.current = false;
      }, 350);
    };

    const handleState = ({ payload }) => {
      if (!payload || payload.roomId !== roomId) {
        return;
      }

      if (ignoreRemoteRef.current) {
        return;
      }

      ignoreRemoteRef.current = true;

      if (payload.url) {
        setVideoUrl(payload.url);
      }

      const incomingTime = Number(payload.time || 0);
      const drift = Math.abs(incomingTime - time);
      if (drift > 2) {
        setTime(incomingTime);
      }

      setPlaying(Boolean(payload.playing));
      window.setTimeout(() => {
        ignoreRemoteRef.current = false;
      }, 350);
    };

    const handleRequest = ({ payload }) => {
      if (!payload || payload.roomId !== roomId) {
        return;
      }

      send('video:reply', {
        roomId,
        url: videoUrl,
        time,
        playing,
      });
    };

    const handleReply = ({ payload }) => {
      if (!payload || payload.roomId !== roomId) {
        return;
      }

      if (payload.url && !videoUrl) {
        setVideoUrl(payload.url);
      }

      const incomingTime = Number(payload.time || 0);
      if (payload.time && Math.abs(incomingTime - time) > 2) {
        setTime(incomingTime);
      }
      setPlaying(Boolean(payload.playing));
    };

    channel.on('broadcast', { event: 'video:load' }, handleLoad);
    channel.on('broadcast', { event: 'video:state' }, handleState);
    channel.on('broadcast', { event: 'video:request_state' }, handleRequest);
    channel.on('broadcast', { event: 'video:reply' }, handleReply);

    return () => {
      channel.off('broadcast', { event: 'video:load' }, handleLoad);
      channel.off('broadcast', { event: 'video:state' }, handleState);
      channel.off('broadcast', { event: 'video:request_state' }, handleRequest);
      channel.off('broadcast', { event: 'video:reply' }, handleReply);
    };
  }, [channel, roomId, send, time, videoUrl, playing]);

  useEffect(() => {
    if (!roomId || !channel || !isHost || !playing) {
      return;
    }

    const timer = window.setInterval(() => {
      const threshold = Date.now() - lastBroadcastRef.current;
      if (threshold >= 10000) {
        broadcastState();
        lastBroadcastRef.current = Date.now();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [broadcastState, channel, isHost, playing, roomId]);

  const requestState = () => {
    if (!channel || !roomId) {
      return;
    }

    channel.send({
      type: 'broadcast',
      event: 'video:request_state',
      payload: { roomId },
    });
  };

  const loadVideo = (nextUrl) => {
    if (!canControl) {
      return;
    }

    const normalized = nextUrl || '';
    setLoading(true);
    setError('');
    setVideoUrl(normalized);
    setTime(0);
    setPlaying(false);
    send('video:load', {
      roomId,
      url: normalized,
      time: 0,
      playing: false,
    });
  };

  const handlePlayPause = (nextPlaying) => {
    if (!canControl) {
      return;
    }

    const nextValue = Boolean(nextPlaying);
    setPlaying(nextValue);
    lastBroadcastRef.current = Date.now();
    broadcastState({ playing: nextValue });
  };

  const handleSeek = (nextTime) => {
    if (!canControl) {
      return;
    }

    const nextValue = Number(nextTime || 0);
    setTime(nextValue);
    lastBroadcastRef.current = Date.now();
    broadcastState({ time: nextValue });
  };

  const handleProgress = (nextTime) => {
    const seconds = Number(nextTime || 0);
    setTime(seconds);

    if (Date.now() - lastBroadcastRef.current > 1000) {
      lastBroadcastRef.current = Date.now();
      broadcastState({ time: seconds });
    }
  };

  const handleDuration = (durationSeconds) => {
    setDuration(Number(durationSeconds || 0));
  };

  const handleVideoError = (message) => {
    setError(message || 'This video could not be loaded.');
    setLoading(false);
  };

  return {
    url: videoUrl,
    playing,
    time,
    duration,
    loading,
    error,
    loadVideo,
    handlePlayPause,
    handleSeek,
    handleProgress,
    handleDuration,
    handleVideoError,
    requestState,
  };
}
