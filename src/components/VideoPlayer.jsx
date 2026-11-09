import { useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { convertApi } from '../utils/convertApi';
import { isDirectPlayableVideo, isGoogleDriveLink, normalizeVideoUrl } from '../utils/videoUrl';

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
  onReady,
}) {
  const [inputValue, setInputValue] = useState(url || '');
  const [localError, setLocalError] = useState('');
  const playerRef = useRef(null);
  const playbackRetryRef = useRef(0);

  const tryResumePlayback = () => {
    if (!playerRef.current) {
      return;
    }

    const internalPlayer = playerRef.current.getInternalPlayer?.();

    if (internalPlayer && typeof internalPlayer.play === 'function') {
      internalPlayer.play();
      return;
    }

    if (internalPlayer && typeof internalPlayer.playVideo === 'function') {
      internalPlayer.playVideo();
      return;
    }

    if (typeof playerRef.current.play === 'function') {
      playerRef.current.play();
    }
  };

  useEffect(() => {
    if (!playerRef.current || !playing || !url) {
      return;
    }

    playbackRetryRef.current += 1;
    const attemptId = playbackRetryRef.current;

    const resume = () => {
      if (attemptId !== playbackRetryRef.current) {
        return;
      }
      tryResumePlayback();
    };

    const timeouts = [
      window.setTimeout(resume, 150),
      window.setTimeout(resume, 500),
      window.setTimeout(resume, 1200),
    ];

    return () => timeouts.forEach((timer) => window.clearTimeout(timer));
  }, [url, playing]);

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

  const handleSubmit = async (event) => {
    event.preventDefault();
    const rawValue = (inputValue || '').trim();
    const normalizedUrl = normalizeVideoUrl(rawValue);

    if (!normalizedUrl) {
      setLocalError('Please enter a valid video URL.');
      return;
    }

    if (isDirectPlayableVideo(normalizedUrl)) {
      setLocalError('');
      setInputValue(normalizedUrl);
      onLoadVideo?.(normalizedUrl);
      return;
    }

    if (isGoogleDriveLink(rawValue)) {
      try {
        setLocalError('Converting Google Drive link…');

        const result = await convertApi.post('/api/jobs', { url: rawValue });
        const jobId = result?.jobId || result?.id;
        if (!jobId) {
          throw new Error('The conversion service did not return a job ID.');
        }

        let finalStatus = null;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const job = await convertApi.get(`/api/jobs/${jobId}`);
          if (['done', 'failed', 'cancelled'].includes(job?.status)) {
            finalStatus = job;
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }

        if (!finalStatus || finalStatus.status !== 'done' || !finalStatus.outputUrl) {
          throw new Error(finalStatus?.error || 'Google Drive conversion did not finish.');
        }

        setLocalError('');
        setInputValue(finalStatus.outputUrl);
        onLoadVideo?.(finalStatus.outputUrl);
        return;
      } catch (error) {
        setLocalError(error.message || 'Google Drive conversion failed.');
        return;
      }
    }

    setLocalError('');
    setInputValue(normalizedUrl);
    onLoadVideo?.(normalizedUrl);
  };

  const driveWarning = isGoogleDriveLink(url);

  return (
    <div>
      <div className="video-shell">
        {url ? (
          <ReactPlayer
            key={url}
            ref={playerRef}
            url={url}
            playing={playing}
            controls
            playsinline
            config={{
              youtube: {
                playerVars: {
                  autoplay: 1,
                  playsinline: 1,
                  rel: 0,
                  controls: 1,
                },
              },
              file: {
                attributes: {
                  autoPlay: true,
                  controls: true,
                },
              },
            }}
            width="100%"
            height="100%"
            onReady={() => {
              if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
                playerRef.current.seekTo(time, 'seconds');
              }

              if (playing) {
                window.setTimeout(() => {
                  tryResumePlayback();
                }, 150);
              }

              onReady?.();
            }}
            onPlay={() => onPlayPause?.(true)}
            onPause={() => onPlayPause?.(false)}
            onEnded={() => onPlayPause?.(false)}
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
