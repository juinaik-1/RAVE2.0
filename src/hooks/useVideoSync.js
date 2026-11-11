import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { normalizeVideoUrl } from '../utils/videoUrl';

export function useVideoSync({ roomId, channel, isHost, canControl, send }) {
  const [videoUrl, setVideoUrl] = useState('');
  const [streamId, setStreamId] = useState('');
  const [streamName, setStreamName] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncNonce, setSyncNonce] = useState(0);
  const ignoreRemoteRef = useRef(false);
  const lastBroadcastRef = useRef(0);
  const streamRequestRef = useRef(0);
  const sendRef = useRef(send);
  const currentRef = useRef({});
  sendRef.current = send;
  currentRef.current = { streamId, streamName, videoUrl, time, playing };

  useEffect(() => {
    streamRequestRef.current += 1;
    ignoreRemoteRef.current = false;
    setVideoUrl('');
    setStreamId('');
    setStreamName('');
    setPlaying(false);
    setTime(0);
    setDuration(0);
    setLoading(false);
    setError('');
  }, [roomId]);

  const broadcastState = useCallback((overrides = {}) => {
    const current = currentRef.current;
    if (!channel || !roomId || (!current.streamId && !current.videoUrl) || ignoreRemoteRef.current) return;
    sendRef.current('video:state', {
      roomId,
      streamId: current.streamId,
      time: Number(overrides.time ?? current.time),
      playing: Boolean(overrides.playing ?? current.playing),
      timestamp: Date.now(),
    });
  }, [channel, roomId]);

  const applyStream = useCallback(async (nextStreamId, name = '') => {
    if (!/^[a-f0-9]{32}$/.test(nextStreamId || '')) return false;
    const requestId = ++streamRequestRef.current;
    setLoading(true);
    setError('');
    try {
      const access = await api.post(`/api/streams/${nextStreamId}/access`);
      if (requestId !== streamRequestRef.current) return false;
      setStreamId(nextStreamId);
      setStreamName(name || access.name || 'Video');
      setVideoUrl(access.url);
      setTime(0);
      setPlaying(true);
      return true;
    } catch (requestError) {
      if (requestId === streamRequestRef.current) {
        setError(requestError.message || 'This shared video is no longer available.');
        setVideoUrl('');
        setStreamId('');
      }
      return false;
    } finally {
      if (requestId === streamRequestRef.current) setLoading(false);
    }
  }, []);

  const applyUrl = useCallback((nextUrl) => {
    const normalized = normalizeVideoUrl(nextUrl);
    if (!normalized) return false;
    streamRequestRef.current += 1;
    setStreamId('');
    setStreamName('');
    setVideoUrl(normalized);
    setTime(0);
    setPlaying(true);
    setLoading(false);
    setError('');
    return true;
  }, []);

  useEffect(() => {
    if (!channel || !roomId) return undefined;
    const applyRemoteStream = async (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      ignoreRemoteRef.current = true;
      const loaded = payload.type === 'stream'
        ? await applyStream(payload.streamId, payload.name)
        : payload.type === 'url' && applyUrl(payload.url);
      if (loaded && Number.isFinite(Number(payload.time))) setTime(Number(payload.time));
      if (loaded && typeof payload.playing === 'boolean') setPlaying(payload.playing);
      if (loaded) setSyncNonce((value) => value + 1);
      window.setTimeout(() => { ignoreRemoteRef.current = false; }, 500);
    };
    const handleLoad = ({ payload }) => { void applyRemoteStream(payload); };
    const handleState = ({ payload }) => {
      if (!payload || payload.roomId !== roomId
          || payload.streamId !== currentRef.current.streamId
          || ignoreRemoteRef.current) return;
      ignoreRemoteRef.current = true;
      const nextTime = Number(payload.time || 0);
      if (Math.abs(nextTime - currentRef.current.time) > 1) setTime(nextTime);
      setPlaying(Boolean(payload.playing));
      setSyncNonce((value) => value + 1);
      window.setTimeout(() => { ignoreRemoteRef.current = false; }, 350);
    };
    const handleSeekEvent = ({ payload }) => {
      const current = currentRef.current;
      if (!payload || payload.roomId !== roomId
          || payload.streamId !== current.streamId
          || (!current.streamId && !current.videoUrl)) return;
      ignoreRemoteRef.current = true;
      setTime(Number(payload.time || 0));
      if (typeof payload.playing === 'boolean') setPlaying(payload.playing);
      setSyncNonce((value) => value + 1);
      window.setTimeout(() => { ignoreRemoteRef.current = false; }, 500);
    };
    const handleRequest = ({ payload }) => {
      const current = currentRef.current;
      if (!payload || payload.roomId !== roomId || (!current.streamId && !current.videoUrl)) return;
      sendRef.current('video:reply', current.streamId ? {
        type: 'stream',
        streamId: current.streamId,
        name: current.streamName,
        time: current.time,
        playing: current.playing,
      } : {
        type: 'url',
        url: current.videoUrl,
        time: current.time,
        playing: current.playing,
      });
    };
    const handleReply = ({ payload }) => {
      if (!payload || payload.roomId !== roomId || (!payload.streamId && !payload.url)) return;
      if (payload.streamId !== currentRef.current.streamId || payload.url !== currentRef.current.videoUrl) {
        void applyRemoteStream({ ...payload, type: payload.streamId ? 'stream' : 'url' });
        return;
      }
      const nextTime = Number(payload.time || 0);
      if (Math.abs(nextTime - currentRef.current.time) > 1) setTime(nextTime);
      setPlaying(Boolean(payload.playing));
      setSyncNonce((value) => value + 1);
    };
    channel.on('broadcast', { event: 'video:load' }, handleLoad);
    channel.on('broadcast', { event: 'video:state' }, handleState);
    channel.on('broadcast', { event: 'video:seek' }, handleSeekEvent);
    channel.on('broadcast', { event: 'video:request_state' }, handleRequest);
    channel.on('broadcast', { event: 'video:reply' }, handleReply);
    return () => {
      channel.off?.('broadcast', { event: 'video:load' }, handleLoad);
      channel.off?.('broadcast', { event: 'video:state' }, handleState);
      channel.off?.('broadcast', { event: 'video:seek' }, handleSeekEvent);
      channel.off?.('broadcast', { event: 'video:request_state' }, handleRequest);
      channel.off?.('broadcast', { event: 'video:reply' }, handleReply);
    };
  }, [applyStream, applyUrl, channel, roomId]);

  useEffect(() => {
    if (!roomId || !channel || !isHost || !playing || (!streamId && !videoUrl)) return undefined;
    const timer = window.setInterval(() => {
      if (Date.now() - lastBroadcastRef.current >= 10_000) {
        broadcastState();
        lastBroadcastRef.current = Date.now();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [broadcastState, channel, isHost, playing, roomId, streamId, videoUrl]);

  const loadStream = useCallback(async (stream) => {
    if (!canControl || !stream?.streamId) return;
    const loaded = await applyStream(stream.streamId, stream.name);
    if (loaded && roomId && channel) {
      sendRef.current('video:load', { roomId, type: 'stream', streamId: stream.streamId, name: stream.name || 'Video' });
    }
  }, [applyStream, canControl, channel, roomId]);

  const loadVideo = useCallback((nextUrl) => {
    if (!canControl) return;
    const normalized = normalizeVideoUrl(nextUrl);
    if (!normalized) {
      setError('Enter a supported HTTP or HTTPS video URL.');
      return;
    }
    if (applyUrl(normalized) && roomId && channel) {
      sendRef.current('video:load', { type: 'url', url: normalized });
    }
  }, [applyUrl, canControl, channel, roomId]);

  const requestState = useCallback(() => {
    channel?.send({ type: 'broadcast', event: 'video:request_state', payload: { roomId } });
  }, [channel, roomId]);

  const handleReady = useCallback(() => {
    setLoading(false);
    setError('');
  }, []);
  const handlePlayPause = useCallback((nextPlaying) => {
    if (!canControl || ignoreRemoteRef.current) return;
    setPlaying(Boolean(nextPlaying));
    lastBroadcastRef.current = Date.now();
    broadcastState({ playing: Boolean(nextPlaying) });
  }, [broadcastState, canControl]);
  const handleSeek = useCallback((nextTime) => {
    if (!canControl || ignoreRemoteRef.current) return;
    const seconds = Number(nextTime || 0);
    const current = currentRef.current;
    setTime(seconds);
    lastBroadcastRef.current = Date.now();
    if (!channel || !roomId || (!current.streamId && !current.videoUrl)) return;
    sendRef.current('video:seek', {
      roomId,
      streamId: current.streamId,
      time: seconds,
      playing: Boolean(current.playing),
    });
  }, [canControl, channel, roomId]);
  const handleProgress = useCallback((nextTime) => {
    const seconds = Number(nextTime || 0);
    setTime(seconds);
    if (isHost && !ignoreRemoteRef.current && (streamId || videoUrl) && Date.now() - lastBroadcastRef.current > 1000) {
      lastBroadcastRef.current = Date.now();
      broadcastState({ time: seconds });
    }
  }, [broadcastState, isHost, streamId, videoUrl]);
  const handleDuration = useCallback((seconds) => setDuration(Number(seconds || 0)), []);
  const handleVideoError = useCallback((message) => {
    setError(message || 'This video could not be loaded.');
    setLoading(false);
  }, []);

  return {
    url: videoUrl,
    streamId,
    streamName,
    playing,
    time,
    duration,
    loading,
    error,
    syncNonce,
    loadVideo,
    loadStream,
    handleReady,
    handlePlayPause,
    handleSeek,
    handleProgress,
    handleDuration,
    handleVideoError,
    requestState,
  };
}
