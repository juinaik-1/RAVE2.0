import { useCallback, useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { Clock, Link2, MonitorPlay, Radio, VolumeX, WandSparkles } from 'lucide-react';
import { Badge, Button, Panel, inputClass } from './ui';
import { normalizeVideoUrl } from '../utils/videoUrl';
import { cn } from '../utils/cn';

function formatDuration(value) {
  const total = Number(value);
  if (!Number.isFinite(total) || total <= 0) return '';
  const seconds = String(Math.floor(total % 60)).padStart(2, '0');
  const minutes = Math.floor((total / 60) % 60);
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function formatTimestamp(value) {
  const total = Number(value);
  if (!Number.isFinite(total) || total < 0) return '0:00';
  const seconds = String(Math.floor(total % 60)).padStart(2, '0');
  const minutes = Math.floor((total / 60) % 60);
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export default function VideoPlayer({
  url, streamId, streamName, playing, time, roomTime, duration = 0, canControl, canConvert = true,
  loading, error, syncNonce = 0, onPlayPause, onSeek, onProgress, onDuration, onLoadVideo, onVideoError, onReady,
  onConvert,
}) {
  const playerRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [localError, setLocalError] = useState('');
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [activated, setActivated] = useState(false);
  const [playerMuted, setPlayerMuted] = useState(true);
  const [mutedForUrl, setMutedForUrl] = useState(url);
  const playingRef = useRef(false);
  // The engine calls play() and pause() itself, and the browser reports those
  // as play and pause events as well. The event can arrive after the room
  // state has already changed, so each call is marked separately and the
  // matching event consumes the mark. Reporting one as a user action would
  // make the room start or stop playing on its own.
  const programmaticPlayAtRef = useRef(0);
  const programmaticPauseAtRef = useRef(0);
  const markProgrammaticPlay = useCallback(() => {
    programmaticPlayAtRef.current = Date.now();
  }, []);
  const markProgrammaticPause = useCallback(() => {
    programmaticPauseAtRef.current = Date.now();
  }, []);
  const consumeProgrammaticEvent = useCallback((kind) => {
    const ref = kind === 'play' ? programmaticPlayAtRef : programmaticPauseAtRef;
    const markedAt = ref.current;
    if (!markedAt) return false;
    ref.current = 0;
    // The engine's call never produced an event (blocked autoplay), so the
    // mark is stale and must not swallow a later user action.
    return Date.now() - markedAt < 2000;
  }, []);
  // True while a seek we performed ourselves is in flight, so the resulting
  // seek event is recognised as an echo rather than a user scrub.
  const programmaticSeekRef = useRef(null);
  const programmaticSeekTimerRef = useRef(0);
  const isStream = Boolean(streamId);
  const isDriveMedia = Boolean(url && /^https:\/\/drive\.google\.com\/uc\?/.test(url));
  const useNativePlayer = isStream || isDriveMedia;

  // Reset the mute state during render so a newly mounted player is created
  // muted from the very first paint (the embedded player only reads `muted` at
  // load time).
  if (mutedForUrl !== url) {
    setMutedForUrl(url);
    setPlayerMuted(true);
  }

  useEffect(() => {
    const markActivated = () => setActivated(true);
    window.addEventListener('pointerdown', markActivated);
    window.addEventListener('keydown', markActivated);
    return () => {
      window.removeEventListener('pointerdown', markActivated);
      window.removeEventListener('keydown', markActivated);
    };
  }, []);

  // Restore audio once playback is running and the page has a gesture.
  useEffect(() => {
    if (activated && playingRef.current) setPlayerMuted(false);
  }, [activated]);

  useEffect(() => {
    setInputValue('');
    setAutoplayBlocked(false);
    setLocalError('');
    playingRef.current = false;
    programmaticSeekRef.current = null;
  }, [streamId, url]);

  // ReactPlayer exposes a different object per provider: a DOM <video> for file/direct
  // URLs, a YT.Player for YouTube, and the Vimeo Player SDK instance for Vimeo. The
  // native renderer is the element itself. Resolve whichever object backs the source.
  const getPlayer = useCallback(() => {
    const ref = playerRef.current;
    if (!ref) return null;
    if (typeof ref.getInternalPlayer === 'function') {
      try { return ref.getInternalPlayer(); } catch { return null; }
    }
    return ref;
  }, []);

  // ReactPlayer only applies `playing` through the HTML autoPlay attribute, so it never
  // re-triggers playback when the value is already true. Reconcile the underlying player
  // directly on every sync message (syncNonce) instead of relying on the boolean changing.
  const syncPlayback = useCallback(() => {
    const player = getPlayer();
    if (!player) return;
    if (typeof player.playVideo === 'function') {
      // YouTube (YT.Player)
      if (playing) {
        markProgrammaticPlay();
        player.playVideo();
      } else if (typeof player.pauseVideo === 'function') {
        markProgrammaticPause();
        player.pauseVideo();
      }
      return;
    }
    if (typeof player.setCurrentTime === 'function' && typeof player.play === 'function') {
      // Vimeo (Player SDK)
      if (playing) markProgrammaticPlay();
      else markProgrammaticPause();
      const result = playing ? player.play() : player.pause();
      if (result?.catch) result.catch(() => setAutoplayBlocked(true));
      return;
    }
    if (typeof player.play === 'function') {
      // HTML5 <video>/<audio>
      if (playing && player.paused) {
        markProgrammaticPlay();
        const playResult = player.play();
        if (playResult?.catch) {
          playResult.catch(() => {
            try { player.muted = true; } catch { /* ignore */ }
            markProgrammaticPlay();
            const mutedResult = player.play();
            if (mutedResult?.catch) mutedResult.catch(() => setAutoplayBlocked(true));
          });
        }
      } else if (!playing && !player.paused) {
        markProgrammaticPause();
        player.pause();
      }
    }
  }, [getPlayer, markProgrammaticPause, markProgrammaticPlay, playing]);

  // The player reports every seek through one event, whether the user dragged
  // the scrub bar or the sync engine moved it. Record the position we seek to
  // ourselves so the hook can tell a deliberate seek from an echo.
  const markProgrammaticSeek = useCallback((target) => {
    programmaticSeekRef.current = { time: Number(target), at: Date.now() };
    window.clearTimeout(programmaticSeekTimerRef.current);
    programmaticSeekTimerRef.current = window.setTimeout(() => {
      programmaticSeekRef.current = null;
    }, 3000);
  }, []);

  const syncTime = useCallback(() => {
    if (!Number.isFinite(time)) return;
    const player = getPlayer();
    if (!player) return;
    if (typeof player.playVideo === 'function' && typeof player.seekTo === 'function') {
      // YouTube (YT.Player)
      const current = Number(player.getCurrentTime?.());
      if (!Number.isFinite(current) || Math.abs(current - time) > 1) {
        markProgrammaticSeek(time);
        player.seekTo(time, true);
      }
      return;
    }
    if (typeof player.setCurrentTime === 'function') {
      // Vimeo (Player SDK) — getCurrentTime/setCurrentTime are async
      Promise.resolve(typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0)
        .then((current) => {
          if (Math.abs((Number(current) || 0) - time) > 1) {
            markProgrammaticSeek(time);
            player.setCurrentTime(time);
          }
        })
        .catch(() => {});
      return;
    }
    if (typeof player.currentTime === 'number') {
      // HTML5 <video>/<audio>
      if (Math.abs((player.currentTime || 0) - time) > 1) {
        markProgrammaticSeek(time);
        player.currentTime = time;
      }
    }
  }, [getPlayer, markProgrammaticSeek, time]);

  useEffect(() => {
    if (!url) return;
    syncPlayback();
  }, [syncPlayback, url, streamId, syncNonce]);

  useEffect(() => {
    if (!url) return;
    syncTime();
  }, [syncTime, url, streamId, syncNonce]);

  // YouTube/Vimeo don't reject play() when the browser blocks autoplay, and a
  // native player can resolve without starting, so probe the player state
  // shortly after a sync to surface the same "Click to start" fallback.
  useEffect(() => {
    if (!url || !playing) return undefined;
    const player = getPlayer();
    const isYouTube = typeof player?.getPlayerState === 'function' && typeof player?.playVideo === 'function';
    const isVimeo = !isYouTube && typeof player?.getPaused === 'function';
    const isHtml5 = !isYouTube && !isVimeo && typeof player?.play === 'function';
    if (!isYouTube && !isVimeo && !isHtml5) return undefined;
    const timer = window.setTimeout(() => {
      try {
        if (isYouTube) {
          const state = player.getPlayerState();
          if (state !== 1 && state !== 3) setAutoplayBlocked(true);
        } else if (isVimeo) {
          Promise.resolve(player.getPaused()).then((paused) => {
            if (paused) setAutoplayBlocked(true);
          }).catch(() => {});
        } else if (player.paused) {
          setAutoplayBlocked(true);
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [getPlayer, url, playing, syncNonce]);

  const reassertRoomState = useCallback(() => {
    syncPlayback();
    syncTime();
  }, [syncPlayback, syncTime]);

  const reportSeek = useCallback((seconds) => {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return;
    // The seek is an echo when it matches a position the sync engine just
    // applied. A user scrub to a different position is always authoritative.
    const pending = programmaticSeekRef.current;
    const isEcho = Boolean(pending)
      && Math.abs(value - pending.time) < 1
      && Date.now() - pending.at < 3000;
    if (isEcho) {
      programmaticSeekRef.current = null;
      window.clearTimeout(programmaticSeekTimerRef.current);
      onSeek?.(value, { userInitiated: false });
      return;
    }
    onSeek?.(value, { userInitiated: true });
  }, [onSeek]);

  const submit = (event) => {
    event.preventDefault();
    const normalized = normalizeVideoUrl(inputValue);
    if (!normalized) {
      setLocalError('Enter an HTTP or HTTPS video URL. Use the Drive picker for Google Drive files.');
      return;
    }
    setLocalError('');
    onLoadVideo?.(normalized);
  };
  const handleUnmute = useCallback(() => {
    setActivated(true);
    setPlayerMuted(false);
    const player = getPlayer();
    if (!player) return;
    try {
      if (typeof player.unmute === 'function') player.unmute();
      else if ('muted' in player) player.muted = false;
    } catch { /* ignore */ }
  }, [getPlayer]);

  const durationLabel = formatDuration(duration);
  const positionLabel = formatTimestamp(roomTime);
  const showUnmute = playerMuted && playing && url;

  return (
    <div className="flex flex-col gap-3">
      <Panel className="overflow-hidden">
        <div className="relative aspect-video w-full overflow-hidden bg-zinc-950">
          <div className={cn('absolute inset-0', !canControl && 'pointer-events-none')}>
          {url ? (useNativePlayer ? (
            <>
              <video
                key={streamId || url}
                ref={playerRef}
                src={url}
                controls={canControl}
                playsInline
                preload="metadata"
                muted={playerMuted}
                className="absolute inset-0 h-full w-full bg-black object-contain"
                onLoadedMetadata={(event) => {
                  if (time > 0) event.currentTarget.currentTime = time;
                  onReady?.({ autoplay: false });
                  syncPlayback();
                  syncTime();
                }}
                onPlay={(event) => {
                  playingRef.current = true;
                  if (activated) {
                    event.currentTarget.muted = false;
                    setPlayerMuted(false);
                  }
                  // The engine started the player itself.
                  if (consumeProgrammaticEvent('play')) return;
                  // The room already believes the video is playing, so there
                  // is nothing to change.
                  if (playing) return;
                  // A viewer without control must follow the host's play state.
                  if (!canControl) {
                    markProgrammaticPause();
                    event.currentTarget.pause();
                    return;
                  }
                  setAutoplayBlocked(false);
                  setLocalError('');
                  onPlayPause?.(true);
                }}
                onPause={() => {
                  playingRef.current = false;
                  // The engine stopped the player itself.
                  if (consumeProgrammaticEvent('pause')) return;
                  // A viewer without control stays on the room's play state.
                  if (!canControl) {
                    reassertRoomState();
                    return;
                  }
                  onPlayPause?.(false);
                }}
                onEnded={() => onPlayPause?.(false)}
                onTimeUpdate={(event) => onProgress?.(event.currentTarget.currentTime)}
                onDurationChange={(event) => onDuration?.(event.currentTarget.duration)}
                onSeeked={(event) => {
                  if (!canControl) {
                    reassertRoomState();
                    return;
                  }
                  reportSeek(event.currentTarget.currentTime);
                }}
                onError={(event) => {
                  const message = event.currentTarget.error?.code
                    ? `This video failed to load (media error ${event.currentTarget.error.code}).`
                    : 'This video failed to load.';
                  setLocalError(message);
                  onVideoError?.(message);
                }}
              />
            </>
          ) : (
            <ReactPlayer
              key={url}
              ref={playerRef}
              url={url}
              playing={playing}
              controls={canControl}
              playsinline
              muted={playerMuted}
              width="100%"
              height="100%"
              className="absolute inset-0"
              onReady={() => { onReady?.(); syncPlayback(); syncTime(); }}
              onPlay={() => {
                playingRef.current = true;
                // Restore audio once the page has a user gesture.
                if (activated) setPlayerMuted(false);
                // The engine started the player itself.
                if (consumeProgrammaticEvent('play')) return;
                // The room already believes the video is playing, so there
                // is nothing to change.
                if (playing) return;
                // A viewer without control must follow the host's play state.
                if (!canControl) {
                  markProgrammaticPause();
                  const player = getPlayer();
                  if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
                  else if (player && typeof player.pause === 'function') player.pause();
                  return;
                }
                setAutoplayBlocked(false);
                onPlayPause?.(true);
              }}
              onPause={() => {
                playingRef.current = false;
                // The engine stopped the player itself.
                if (consumeProgrammaticEvent('pause')) return;
                // A viewer without control stays on the room's play state.
                if (!canControl) {
                  reassertRoomState();
                  return;
                }
                onPlayPause?.(false);
              }}
              onEnded={() => onPlayPause?.(false)}
              onProgress={(state) => onProgress?.(Number(state.playedSeconds || 0))}
              onDuration={(seconds) => onDuration?.(Number(seconds || 0))}
              onSeek={(seconds) => {
                if (!canControl) {
                  reassertRoomState();
                  return;
                }
                reportSeek(Number(seconds || 0));
              }}
              onError={(playerError) => {
                const message = playerError?.message || 'This video could not be played.';
                setLocalError(message);
                onVideoError?.(message);
              }}
            />
          )) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400">
                <MonitorPlay className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">No video loaded</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-zinc-500">
                  Pick a video from your Drive, paste a YouTube URL, or convert a video to share it.
                </p>
              </div>
            </div>
          )}
          </div>
          {autoplayBlocked ? (
            <button
              type="button"
              className="absolute inset-0 z-10 m-auto flex h-12 w-fit items-center justify-center rounded-md bg-black/75 px-5 text-sm font-medium text-white"
              onClick={syncPlayback}
            >
              Click to start playback
            </button>
          ) : null}
          {showUnmute ? (
            <button
              type="button"
              className="absolute bottom-3 left-3 z-10 flex h-9 w-fit items-center justify-center gap-1.5 rounded-md bg-black/75 px-3 text-xs font-medium text-white"
              onClick={handleUnmute}
            >
              <VolumeX className="h-3.5 w-3.5" />
              Click to Unmute
            </button>
          ) : null}
          {loading ? <div role="status" aria-label="Loading video" className="absolute inset-0 animate-pulse bg-zinc-950/60" /> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 px-3 py-2 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={url ? 'accent' : 'neutral'} dot>{isStream ? streamName || 'Drive stream' : url ? 'Video link' : 'No source'}</Badge>
            {url ? (
              <Badge className="tabular-nums">
                <Clock className="h-3 w-3" />
                <span className="inline-block w-11 text-right">{positionLabel}</span>
                <span className="text-zinc-400">/</span>
                <span className="inline-block w-11 text-left">{durationLabel || '--:--'}</span>
              </Badge>
            ) : null}
            {url ? <Badge tone={playing ? 'success' : 'warning'} dot>{playing ? 'Playing' : 'Paused'}</Badge> : null}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <Radio className="h-3.5 w-3.5" />{canControl ? 'You can control playback' : 'Host controls playback'}
          </div>
        </div>
      </Panel>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className={cn(inputClass, 'pl-9')}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="YouTube or direct video URL"
            aria-label="Video URL"
            disabled={!canControl}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!canControl || !inputValue.trim()}>Load video</Button>
        {canConvert ? (
          <Button
            type="button"
            variant="ghost"
            title="Convert a video in a new tab so the room keeps playing"
            onClick={() => (onConvert ? onConvert() : window.open('/convert', '_blank'))}
          >
            <WandSparkles className="h-4 w-4" /> Convert
          </Button>
        ) : null}
      </form>
      {localError || error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {localError || error}
        </p>
      ) : null}
    </div>
  );
}
