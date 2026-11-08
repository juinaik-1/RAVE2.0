import { useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { isGoogleDriveLink, normalizeVideoUrl } from '../utils/videoUrl';

export default function VideoPlayer({
  url,
  playing,
  time,
  canControl,
  isHost,
  loading,
  error,
  onPlayPause,
  onSeek,
  onProgress,
  onDuration,
  onLoadVideo,
  onVideoError,
}) {
  const [inputValue, setInputValue] = useState(url || '');
  const [localError, setLocalError] = useState('');
  const playerRef = useRef(null);

  useEffect(() => {
    setInputValue(url || '');
  }, [url]);

  useEffect(() => {
    if (!playerRef.current || !Number.isFinite(time)) {
      return;
    }

    const current = playerRef.current.getCurrentTime?.() ?? 0;
    if (Math.abs(current - time) > 2) {
      playerRef.current.seekTo?.(time, 'seconds');
    }
  }, [time]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const normalizedUrl = normalizeVideoUrl(inputValue);

    if (!normalizedUrl) {
      setLocalError('Please enter a valid video URL.');
      return;
    }

    setLocalError('');
    onLoadVideo?.(normalizedUrl);
  };

  const driveWarning = isGoogleDriveLink(url);

  return (
    <div>
      <div className="video-shell">
        {url ? (
          <ReactPlayer
            ref={playerRef}
            url={url}
            playing={playing}
            controls
            width="100%"
            height="100%"
            onReady={() => {
              if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
                playerRef.current.seekTo(time, 'seconds');
              }
            }}
            onPlay={() => onPlayPause?.(true)}
            onPause={() => onPlayPause?.(false)}
            onProgress={(state) => {
              const seconds = Number(state.playedSeconds || 0);
              onProgress?.(seconds);
            }}
            onDuration={(durationSeconds) => onDuration?.(Number(durationSeconds || 0))}
            onSeek={(seconds) => onSeek?.(Number(seconds || 0))}
            onError={(event) => {
              const message = event?.message || 'This video failed to load.';
              setLocalError(message);
              onVideoError?.(message);
            }}
          />
        ) : (
          <div className="video-overlay">Paste a video link to start the room</div>
        )}
      </div>

      <form className="video-form" onSubmit={handleSubmit}>
        <input
          className="text-input"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="YouTube link or direct video URL"
          disabled={!canControl}
        />
        <button type="submit" className="primary-btn" disabled={!canControl}>
          Load video
        </button>
      </form>

      {driveWarning ? (
        <div className="warning-box">
          Google Drive links can be flaky for large files because Google may run a virus scan or enforce download quotas. YouTube is usually the most reliable option for shared watching.
        </div>
      ) : null}

      {!canControl && isHost === false ? (
        <div className="info-box">Host-only controls are enabled. Only the current host can change videos or playback.</div>
      ) : null}

      {loading ? <div className="tiny-message">Loading video…</div> : null}
      {error || localError ? <div className="error-box">{error || localError}</div> : null}
    </div>
  );
}
