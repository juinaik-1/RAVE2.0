import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { normalizeVideoUrl } from '../utils/videoUrl';

// Remote timestamps within this window count as the same position. A state update
// inside the window only syncs the play/pause flag, which keeps same-timestamp
// play/pause toggles instant instead of seeking on every toggle.
const SYNC_TIME_THRESHOLD = 1.5;
// A manual "request sync" reply may correct a slightly larger drift.
const REPLY_TIME_THRESHOLD = 1.0;
// Latency compensation is only trustworthy for fresh payloads.
const MAX_LATENCY_COMPENSATION = 5;
// A local seek this close to the applied position is an echo of a remote seek.
const SEEK_ECHO_THRESHOLD = 0.25;
// How far a progress report may sit from the pending seek target and still count
// as that seek having completed.
const SEEK_SETTLE_TOLERANCE = 1.5;
// How long a remote stream load suppresses local broadcasts.
const APPLY_REMOTE_MS = 500;

export function useVideoSync({
  roomId, channel, isHost, canControl, send, hostOnlyControls = false, hostId = null, userId = null,
}) {
  const [videoUrl, setVideoUrl] = useState('');
  const [streamId, setStreamId] = useState('');
  const [streamName, setStreamName] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  // The room's clock: the position the room is at, used for the displayed
  // timestamp so it does not jitter with the local player's progress.
  const [roomTime, setRoomTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncNonce, setSyncNonce] = useState(0);
  // True only while a remote video is being loaded, so we don't broadcast stale
  // local state for the previous source.
  const applyingRemoteRef = useRef(false);
  // Set while the local user is dragging the scrub bar. A user-initiated seek is
  // authoritative and must be broadcast even when it lands close to the current
  // position, so it bypasses the remote-echo threshold entirely.
  const isUserSeekingRef = useRef(false);
  // The position the user seeked to, used to recognise the progress report that
  // completes the seek.
  const userSeekTargetRef = useRef(0);
  // The room clock as last reported by the host, plus when it was reported, so
  // viewers can advance it locally between heartbeats instead of jumping.
  const roomClockRef = useRef({ time: 0, at: 0 });
  const lastBroadcastRef = useRef(0);
  const streamRequestRef = useRef(0);
  const sendRef = useRef(send);
  const currentRef = useRef({});
  sendRef.current = send;
  currentRef.current = { streamId, streamName, videoUrl, time, playing };

  useEffect(() => {
    streamRequestRef.current += 1;
    applyingRemoteRef.current = false;
    setVideoUrl('');
    setStreamId('');
    setStreamName('');
    setPlaying(false);
    setTime(0);
    setRoomTime(0);
    setDuration(0);
    setLoading(false);
    setError('');
  }, [roomId]);

  const broadcastState = useCallback((overrides = {}) => {
    const current = currentRef.current;
    if (!channel || !roomId || (!current.streamId && !current.videoUrl) || applyingRemoteRef.current) return;
    sendRef.current('video:state', {
      roomId,
      streamId: current.streamId,
      url: current.videoUrl,
      time: Number(overrides.time ?? current.time),
      playing: Boolean(overrides.playing ?? current.playing),
      isHost,
      senderId: userId,
      timestamp: Date.now(),
    });
  }, [channel, roomId, isHost, userId]);

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
      // Start paused: the room's video loads in a known state and whoever has
      // control presses play to start it for everyone.
      setPlaying(false);
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
    // Start paused: the room's video loads in a known state and whoever has
    // control presses play to start it for everyone.
    setPlaying(false);
    setLoading(false);
    setError('');
    return true;
  }, []);

  useEffect(() => {
    if (!channel || !roomId) return undefined;

    // A payload identifies its source by streamId when it has one, otherwise by
    // URL. Replies/requests may only carry one of the two, so never require both.
    const isSameSource = (payload, current) => {
      if (payload.streamId) return payload.streamId === current.streamId;
      if (payload.url) return payload.url === current.videoUrl;
      return false;
    };

    const isHostPayload = (payload) => Boolean(payload && payload.isHost);

    // With host-only controls enabled, only the room host may drive playback.
    // A payload is trusted when it carries the host's id, or falls back to the
    // legacy isHost flag for peers that predate senderId.
    const isTrustedHost = (payload) => {
      if (!hostOnlyControls) return true;
      if (payload?.senderId) return payload.senderId === hostId;
      return isHostPayload(payload);
    };

    // Apply a remote time/playing pair. The ref is updated immediately so the
    // local player's own play/pause/seek events are recognised as echoes even
    // before React re-renders.
    const applyRemotePlayback = (payload, threshold = SYNC_TIME_THRESHOLD) => {
      const current = currentRef.current;
      let nextTime = Number(payload.time || 0);
      // Compensate for transit time while the host is playing. A paused payload
      // is an exact position and must not be shifted.
      if (payload.playing && payload.timestamp) {
        const delay = (Date.now() - payload.timestamp) / 1000;
        if (delay > 0 && delay < MAX_LATENCY_COMPENSATION) nextTime += delay;
      }
      const timeDiff = Math.abs(nextTime - current.time);
      const playingChanged = Boolean(payload.playing) !== Boolean(current.playing);
      // The room clock advances on every remote update, even when the local
      // player is close enough that no seek is needed, so the displayed
      // timestamp tracks the room rather than the local progress.
      roomClockRef.current = { time: nextTime, at: Date.now() };
      setRoomTime(nextTime);
      if (!playingChanged && timeDiff <= threshold) return;

      // Transitioning to paused: the heartbeat stops while paused, so a near-miss
      // offset would never be corrected. Snap exactly to the host's timestamp.
      const isPauseTransition = playingChanged && !payload.playing;
      const next = { ...current, playing: Boolean(payload.playing) };
      if (timeDiff > threshold || isPauseTransition) next.time = nextTime;
      currentRef.current = next;
      if (timeDiff > threshold || isPauseTransition) setTime(nextTime);
      setPlaying(Boolean(payload.playing));
      setSyncNonce((value) => value + 1);
    };

    const applyRemoteStream = async (payload) => {
      if (!payload || payload.roomId !== roomId) return;
      applyingRemoteRef.current = true;
      const loaded = payload.type === 'stream'
        ? await applyStream(payload.streamId, payload.name)
        : payload.type === 'url' && applyUrl(payload.url);
      if (loaded && Number.isFinite(Number(payload.time))) {
        currentRef.current = { ...currentRef.current, time: Number(payload.time) };
        setTime(Number(payload.time));
        setRoomTime(Number(payload.time));
      }
      if (loaded && typeof payload.playing === 'boolean') {
        currentRef.current = { ...currentRef.current, playing: payload.playing };
        setPlaying(payload.playing);
      }
      if (loaded) setSyncNonce((value) => value + 1);
      window.setTimeout(() => { applyingRemoteRef.current = false; }, APPLY_REMOTE_MS);
    };

    const handleLoad = ({ payload }) => { void applyRemoteStream(payload); };
    const handleState = ({ payload }) => {
      if (!payload || payload.roomId !== roomId) return;
      if (!isSameSource(payload, currentRef.current)) return;
      // With host-only controls enabled, only the host may drive playback.
      if (!isTrustedHost(payload)) return;
      applyRemotePlayback(payload);
    };
    const handleSeekEvent = ({ payload }) => {
      if (!payload || payload.roomId !== roomId || applyingRemoteRef.current) return;
      const current = currentRef.current;
      if (!isSameSource(payload, current) || (!current.streamId && !current.videoUrl)) return;
      if (!isTrustedHost(payload)) return;
      const nextTime = Number(payload.time || 0);
      currentRef.current = { ...current, time: nextTime };
      setTime(nextTime);
      setRoomTime(nextTime);
      if (typeof payload.playing === 'boolean') {
        currentRef.current = { ...currentRef.current, playing: payload.playing };
        setPlaying(payload.playing);
      }
      setSyncNonce((value) => value + 1);
    };
    const handleRequest = ({ payload }) => {
      // Only the host answers a state request, so replies never race each other.
      if (!isHost) return;
      const current = currentRef.current;
      if (!payload || payload.roomId !== roomId || (!current.streamId && !current.videoUrl)) return;
      sendRef.current('video:reply', {
        roomId,
        type: current.streamId ? 'stream' : 'url',
        streamId: current.streamId,
        url: current.videoUrl,
        name: current.streamName,
        time: current.time,
        playing: current.playing,
        isHost,
        // Identify the sender so the requester can authorise the reply, and
        // target it so only the joiner that asked applies it.
        senderId: userId,
        requesterId: payload.requesterId || null,
        timestamp: Date.now(),
      });
    };
    const handleReply = ({ payload }) => {
      if (!payload || payload.roomId !== roomId) return;
      // Only the joiner that requested the state applies the reply.
      if (payload.requesterId && payload.requesterId !== userId) return;
      // With host-only controls enabled, only the host may drive playback.
      if (!isTrustedHost(payload)) return;
      const current = currentRef.current;
      const hasLocalSource = Boolean(current.streamId || current.videoUrl);
      if (!isSameSource(payload, current)) {
        // A reply for a video we don't have yet is how a fresh joiner picks up
        // the room's current source. Otherwise it is for another room video.
        if (!hasLocalSource) {
          // A late joiner starts paused and waits for the host to press play.
          void applyRemoteStream({
            ...payload,
            playing: false,
            type: payload.streamId ? 'stream' : 'url',
          });
        }
        return;
      }
      applyRemotePlayback(payload, REPLY_TIME_THRESHOLD);
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
  }, [applyStream, applyUrl, channel, roomId, isHost, canControl, hostId, userId, hostOnlyControls]);

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

  // Viewers only receive the room clock on each heartbeat, so advance it
  // locally between updates to keep the displayed timestamp smooth.
  useEffect(() => {
    if (!playing || isHost) return undefined;
    const timer = window.setInterval(() => {
      const { time, at } = roomClockRef.current;
      if (!at) return;
      setRoomTime(time + (Date.now() - at) / 1000);
    }, 500);
    return () => window.clearInterval(timer);
  }, [isHost, playing]);

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
    channel?.send({
      type: 'broadcast',
      event: 'video:request_state',
      payload: { roomId, requesterId: userId },
    });
  }, [channel, roomId, userId]);

  const handleReady = useCallback(() => {
    setLoading(false);
    setError('');
  }, []);

  const handlePlayPause = useCallback((nextPlaying) => {
    if (!canControl) return;
    const target = Boolean(nextPlaying);
    const current = currentRef.current;
    // Ignore echoes from the local player after a remote update was applied.
    if (target === Boolean(current.playing)) return;
    currentRef.current = { ...current, playing: target };
    setPlaying(target);
    lastBroadcastRef.current = Date.now();
    broadcastState({ playing: target });
  }, [broadcastState, canControl]);

  // A seek can arrive two ways: the user dragged the scrub bar, or the local
  // player echoed back a seek we applied from a remote update. Only the latter
  // must be filtered, so the caller tells us which it is.
  const handleSeek = useCallback((nextTime, options = {}) => {
    if (!canControl || applyingRemoteRef.current) return;
    const seconds = Number(nextTime || 0);
    if (!Number.isFinite(seconds)) return;
    const current = currentRef.current;
    const userInitiated = options.userInitiated === true;
    if (userInitiated) {
      // A deliberate seek is authoritative: broadcast it even when it lands
      // within the echo threshold of the current position.
      isUserSeekingRef.current = true;
      userSeekTargetRef.current = seconds;
    } else if (Math.abs(seconds - current.time) < SEEK_ECHO_THRESHOLD) {
      // Ignore echoes from a seek the local player performed for a remote update.
      return;
    }
    currentRef.current = { ...current, time: seconds };
    setTime(seconds);
    setRoomTime(seconds);
    lastBroadcastRef.current = Date.now();
    if (!channel || !roomId || (!current.streamId && !current.videoUrl)) return;
    sendRef.current('video:seek', {
      roomId,
      streamId: current.streamId,
      url: current.videoUrl,
      time: seconds,
      playing: Boolean(current.playing),
      isHost,
      senderId: userId,
    });
  }, [canControl, channel, roomId, isHost, userId]);

  const handleProgress = useCallback((nextTime) => {
    const seconds = Number(nextTime || 0);
    // While a user-initiated seek is settling, the local player reports the
    // pre-seek position for a moment. Ignore those reports so they cannot
    // overwrite the position we just applied and broadcast.
    if (isUserSeekingRef.current) {
      if (Math.abs(seconds - userSeekTargetRef.current) > SEEK_SETTLE_TOLERANCE) return;
      isUserSeekingRef.current = false;
    }
    setTime(seconds);
    // The host is the room's clock, so its own progress drives the displayed
    // timestamp for everyone.
    if (isHost) setRoomTime(seconds);
    if (isHost && !applyingRemoteRef.current && (streamId || videoUrl) && Date.now() - lastBroadcastRef.current > 1000) {
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
    roomTime,
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
