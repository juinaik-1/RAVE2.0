import { useCallback, useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { Clock, Link2, MonitorPlay, Radio, WandSparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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

export default function VideoPlayer({
  url, streamId, streamName, playing, time, duration = 0, canControl, canConvert = true,
  loading, error, syncNonce = 0, onPlayPause, onSeek, onProgress, onDuration, onLoadVideo, onVideoError, onReady,
}) {
  const navigate = useNavigate();
  const playerRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [localError, setLocalError] = useState('');
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const isStream = Boolean(streamId);
  const isDriveMedia = Boolean(url && /^https:\/\/drive\.google\.com\/uc\?/.test(url));
  const useNativePlayer = isStream || isDriveMedia;

  useEffect(() => {
    setInputValue('');
    setAutoplayBlocked(false);
    setLocalError('');
  }, [streamId]);

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
      if (playing) player.playVideo();
      else if (typeof player.pauseVideo === 'function') player.pauseVideo();
      return;
    }
    if (typeof player.setCurrentTime === 'function' && typeof player.play === 'function') {
      // Vimeo (Player SDK)
      const result = playing ? player.play() : player.pause();
      if (result?.catch) result.catch(() => setAutoplayBlocked(true));
      return;
    }
    if (typeof player.play === 'function') {
      // HTML5 <video>/<audio>
      if (playing && player.paused) {
        const playResult = player.play();
        if (playResult?.catch) playResult.catch(() => setAutoplayBlocked(true));
      } else if (!playing && !player.paused) {
        player.pause();
      }
    }
  }, [getPlayer, playing]);

  const syncTime = useCallback(() => {
    if (!Number.isFinite(time)) return;
    const player = getPlayer();
    if (!player) return;
    if (typeof player.playVideo === 'function' && typeof player.seekTo === 'function') {
      // YouTube (YT.Player)
      const current = Number(player.getCurrentTime?.());
      if (!Number.isFinite(current) || Math.abs(current - time) > 1) player.seekTo(time, true);
      return;
    }
    if (typeof player.setCurrentTime === 'function') {
      // Vimeo (Player SDK) — getCurrentTime/setCurrentTime are async
      Promise.resolve(typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0)
        .then((current) => {
          if (Math.abs((Number(current) || 0) - time) > 1) player.setCurrentTime(time);
        })
        .catch(() => {});
      return;
    }
    if (typeof player.currentTime === 'number') {
      // HTML5 <video>/<audio>
      if (Math.abs((player.currentTime || 0) - time) > 1) player.currentTime = time;
    }
  }, [getPlayer, time]);

  useEffect(() => {
    if (!url) return;
    syncPlayback();
  }, [syncPlayback, url, streamId, syncNonce]);

  useEffect(() => {
    if (!url) return;
    syncTime();
  }, [syncTime, url, streamId, syncNonce]);

  // YouTube/Vimeo don't reject play() when the browser blocks autoplay, so probe the
  // player state shortly after a sync to surface the same "Click to start" fallback.
  useEffect(() => {
    if (!url || !playing) return undefined;
    const player = getPlayer();
    const isYouTube = typeof player?.getPlayerState === 'function' && typeof player?.playVideo === 'function';
    const isVimeo = !isYouTube && typeof player?.getPaused === 'function';
    if (!isYouTube && !isVimeo) return undefined;
    const timer = window.setTimeout(() => {
      try {
        if (isYouTube) {
          const state = player.getPlayerState();
          if (state !== 1 && state !== 3) setAutoplayBlocked(true);
        } else {
          Promise.resolve(player.getPaused()).then((paused) => {
            if (paused) setAutoplayBlocked(true);
          }).catch(() => {});
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [getPlayer, url, playing, syncNonce]);

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
  const durationLabel = formatDuration(duration);

  return (
    <div className="flex flex-col gap-3">
      <Panel className="overflow-hidden">
        <div className="relative aspect-video w-full overflow-hidden bg-zinc-950">
          {url ? (useNativePlayer ? (
            <>
              <video
                key={streamId || url}
                ref={playerRef}
                src={url}
                controls={canControl}
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full bg-black object-contain"
                onLoadedMetadata={(event) => {
                  if (time > 0) event.currentTarget.currentTime = time;
                  onReady?.({ autoplay: false });
                  syncPlayback();
                  syncTime();
                }}
                onPlay={() => { setAutoplayBlocked(false); setLocalError(''); onPlayPause?.(true); }}
                onPause={() => onPlayPause?.(false)}
                onEnded={() => onPlayPause?.(false)}
                onTimeUpdate={(event) => onProgress?.(event.currentTarget.currentTime)}
                onDurationChange={(event) => onDuration?.(event.currentTarget.duration)}
                onSeeked={(event) => onSeek?.(event.currentTarget.currentTime)}
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
              width="100%"
              height="100%"
              className="absolute inset-0"
              onReady={() => { onReady?.(); syncPlayback(); syncTime(); }}
              onPlay={() => { setAutoplayBlocked(false); onPlayPause?.(true); }}
              onPause={() => onPlayPause?.(false)}
              onEnded={() => onPlayPause?.(false)}
              onProgress={(state) => onProgress?.(Number(state.playedSeconds || 0))}
              onDuration={(seconds) => onDuration?.(Number(seconds || 0))}
              onSeek={(seconds) => onSeek?.(Number(seconds || 0))}
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
          {autoplayBlocked ? (
            <button
              type="button"
              className="absolute inset-0 z-10 m-auto flex h-12 w-fit items-center justify-center rounded-md bg-black/75 px-5 text-sm font-medium text-white"
              onClick={syncPlayback}
            >
              Click to start playback
            </button>
          ) : null}
          {loading ? <div role="status" aria-label="Loading video" className="absolute inset-0 animate-pulse bg-zinc-950/60" /> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 px-3 py-2 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={url ? 'accent' : 'neutral'} dot>{isStream ? streamName || 'Drive stream' : url ? 'Video link' : 'No source'}</Badge>
            {durationLabel ? <Badge><Clock className="h-3 w-3" />{durationLabel}</Badge> : null}
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
            onClick={() => navigate('/convert', { state: { roomId: window.location.pathname.split('/').pop() } })}
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
