import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Film, X, XCircle } from 'lucide-react';
import DriveSource from '../components/DriveSource';
import { Badge, Button, Field, Panel, inputClass } from '../components/ui';
import { useConversion } from '../hooks/useConversion';
import { publishConvertedVideo, subscribeConvertedVideoAck, getConvertRequestId } from '../utils/roomBridge';

const PUBLISH_RETRY_MS = 2000;
const MAX_PUBLISH_ATTEMPTS = 15;

export default function Convert() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The room tab opens this page in a separate tab so the room keeps playing.
  // These parameters carry that context across the tab boundary.
  const roomId = searchParams.get('room') || location.state?.roomId || '';
  const [requestId, setRequestId] = useState(searchParams.get('request') || '');
  const streamParam = searchParams.get('stream') || '';
  const nameParam = searchParams.get('name') || '';
  const initialSource = location.state?.streamId
    ? { streamId: location.state.streamId, name: location.state.name || 'Drive video' }
    : streamParam
      ? { streamId: streamParam, name: nameParam || 'Drive video' }
      : null;
  const [sourceType, setSourceType] = useState(initialSource ? 'drive' : 'url');
  const [source, setSource] = useState(initialSource);
  const [url, setUrl] = useState('');
  const [audioTrack, setAudioTrack] = useState('');
  const [resolution, setResolution] = useState('original');
  const [roomCode, setRoomCode] = useState(roomId);
  const [sentToRoom, setSentToRoom] = useState(false);
  const [roomReceived, setRoomReceived] = useState(false);
  const roomReceivedRef = useRef(false);
  const publishedStreamRef = useRef('');
  const { job, error, start, convert, cancel } = useConversion();
  const busy = Boolean(job && ['queued', 'downloading', 'analyzing', 'converting'].includes(job.status));
  const startedRef = useRef(false);
  const stage = useMemo(() => {
    if (!job) return '';
    if (job.status === 'downloading') return 'Downloading';
    if (job.status === 'analyzing') return 'Analyzing';
    if (job.status === 'converting' || job.status === 'queued') return job.progress >= 40 ? 'Converting' : 'Downloading';
    if (job.status === 'awaiting_options') return 'Choose options';
    if (job.status === 'done') return 'Done';
    if (job.status === 'failed') return 'Failed';
    if (job.status === 'cancelled') return 'Cancelled';
    return job.status;
  }, [job]);

  const startConversion = (event) => {
    event.preventDefault();
    if (sourceType === 'drive' && source?.streamId) {
      start({ streamId: source.streamId });
      return;
    }
    start({ url: url.trim() });
  };

  // The room tab opens this page in a separate tab with the source already
  // picked. Start the job right away so the room can keep playing instead of
  // waiting for two extra clicks.
  useEffect(() => {
    if (startedRef.current) return;
    if (!initialSource?.streamId) return;
    startedRef.current = true;
    // The options are supplied up front, so the server converts as soon as the
    // source is analysed instead of pausing for an options round-trip.
    void start({ streamId: initialSource.streamId }, { autoStart: true, resolution: 'original' });
  }, [initialSource, start]);

  useEffect(() => {
    if (requestId || !roomId) return;
    setRequestId(getConvertRequestId(roomId));
  }, [requestId, roomId]);

  // Listen for the room tab confirming it applied the video. This is
  // registered before the video is published so the reply is never missed.
  useEffect(() => {
    return subscribeConvertedVideoAck((ack) => {
      if (ack?.streamId && ack.streamId === job?.outputStreamId) {
        roomReceivedRef.current = true;
        setRoomReceived(true);
      }
    });
  }, [job?.outputStreamId]);

  // Hand the finished video to the room tab that asked for it. The message is
  // repeated until the room confirms it, so a room tab that was reloading at
  // that exact moment still receives the handoff.
  useEffect(() => {
    if (job?.status !== 'done' || !job.outputStreamId || !roomId || !requestId) return undefined;
    const streamId = job.outputStreamId;
    if (publishedStreamRef.current === streamId) return undefined;
    publishedStreamRef.current = streamId;
    const name = job.sourceName || 'Converted video';
    let attempts = 0;
    let cancelled = false;
    const publish = () => {
      if (cancelled || roomReceivedRef.current) return;
      attempts += 1;
      publishConvertedVideo({ roomId, requestId, streamId, name });
    };
    setSentToRoom(true);
    publish();
    const timer = window.setInterval(() => {
      if (roomReceivedRef.current || attempts >= MAX_PUBLISH_ATTEMPTS) {
        window.clearInterval(timer);
        return;
      }
      publish();
    }, PUBLISH_RETRY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job, roomId, requestId]);

  const focusRoomTab = () => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  };

  // Close the conversion tab. The room tab keeps playing, so the user just
  // switches back to it. Browsers only allow window.close() for tabs that were
  // opened by script, so fall back to a blank page when that is refused.
  const closeTab = () => {
    try {
      window.close();
    } catch {
      /* ignore */
    }
    // If the tab did not close, replace it with a minimal page so it does not
    // keep polling the job.
    window.setTimeout(() => {
      if (!window.closed) {
        document.body.innerHTML = '';
        window.location.replace('about:blank');
      }
    }, 200);
  };

  const share = () => {
    const code = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!code || !job?.outputStreamId) return;
    // If the room tab is still open, hand the video over instead of loading it
    // again in this tab.
    if (roomId === code && !sentToRoom) {
      publishConvertedVideo({
        roomId: code,
        requestId,
        streamId: job.outputStreamId,
        name: job.sourceName || 'Converted video',
      });
      setSentToRoom(true);
      focusRoomTab();
      return;
    }
    navigate(`/room/${code}`, {
      state: { streamId: job.outputStreamId, name: job.sourceName || 'Converted video' },
    });
  };

  const streamWithoutConversion = () => {
    const code = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!code || !source?.streamId || !source.playable) return;
    navigate(`/room/${code}`, {
      state: { streamId: source.streamId, name: source.name || 'Drive video' },
    });
  };

  const back = () => {
    if (focusRoomTab()) return;
    // This tab was opened from the room, so go straight back to it when the
    // opener cannot be focused. A plain history back does nothing here
    // because the tab has no earlier entry of its own.
    if (roomId) {
      navigate(`/room/${roomId}`);
      return;
    }
    navigate(-1);
  };

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 dark:bg-zinc-950 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" size="sm" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <h1 className="mt-5 flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          <Film className="h-5 w-5" /> Convert a video
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Convert Drive videos in formats such as MKV, AVI, or HEVC, or provide a video URL, into a shareable H.264 MP4.
        </p>

        {roomId ? (
          <p className="mt-4 rounded-md border border-zinc-200/80 bg-white px-3 py-2 text-xs leading-5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Converting in this tab so room <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{roomId}</span> keeps playing.
            The finished video is sent to the room automatically.
          </p>
        ) : null}

        {!busy && !['awaiting_options', 'done'].includes(job?.status) ? (
          <Panel className="mt-5 space-y-5 p-5">
            <div className="flex gap-2" role="group" aria-label="Conversion source">
              <Button variant={sourceType === 'drive' ? 'primary' : 'secondary'} onClick={() => setSourceType('drive')}>
                From my Drive (picked)
              </Button>
              <Button variant={sourceType === 'url' ? 'primary' : 'secondary'} onClick={() => setSourceType('url')}>
                From a URL
              </Button>
            </div>
            {sourceType === 'drive' ? (
              <>
                <DriveSource
                  autoLoad={false}
                  onSelectSource={setSource}
                />
                {source?.streamId ? (
                  <p className="text-xs text-zinc-500">Selected: {source.name}</p>
                ) : null}
                {source?.streamId && source.playable ? (
                  <div className="space-y-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                    <p className="text-sm text-emerald-800 dark:text-emerald-300">
                      This video is browser-compatible and can stream directly without conversion.
                    </p>
                    <Field label="Room code" htmlFor="direct-stream-room" hint="Enter the room where you want to stream this video.">
                      <input
                        id="direct-stream-room"
                        className={inputClass}
                        value={roomCode}
                        onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                        maxLength={6}
                        placeholder="ABC123"
                      />
                    </Field>
                    <Button className="w-full" onClick={streamWithoutConversion} disabled={roomCode.trim().length < 4}>
                      Stream without conversion
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <Field label="Video URL" htmlFor="convert-url" hint="HTTP/HTTPS URL or a site supported by yt-dlp.">
                <input
                  id="convert-url"
                  className={inputClass}
                  type="url"
                  maxLength={2048}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/video"
                  autoComplete="url"
                />
              </Field>
            )}
            {!(sourceType === 'drive' && source?.playable) ? (
              <Button
                className="w-full"
                onClick={startConversion}
                disabled={sourceType === 'drive' ? !source?.streamId : !url.trim()}
              >
                Analyze source
              </Button>
            ) : null}
          </Panel>
        ) : null}

        {job && !['done', 'failed', 'cancelled'].includes(job.status) ? (
          <Panel className="mt-5 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{stage}</p>
                <p className="mt-1 text-xs text-zinc-500">{job.message}</p>
              </div>
              <Badge tone={job.status === 'awaiting_options' ? 'accent' : 'neutral'}>{Math.round(job.progress || 0)}%</Badge>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, job.progress || 0)}%` }} />
            </div>
            {job.status === 'awaiting_options' ? (
              <div className="mt-5 space-y-4">
                <Field label="Audio track" htmlFor="audio-track">
                  <select
                    id="audio-track"
                    className={inputClass}
                    value={audioTrack !== '' ? audioTrack : (job.audioTracks?.[0]?.index ?? '')}
                    onChange={(event) => setAudioTrack(event.target.value)}
                  >
                    {job.audioTracks?.length ? job.audioTracks.map((track) => (
                      <option key={track.index} value={track.index}>
                        {track.language} · {track.codec} · {track.channels || '?'} channels{track.title ? ` · ${track.title}` : ''}
                      </option>
                    )) : <option value="">No audio track</option>}
                  </select>
                </Field>
                <Field label="Resolution" htmlFor="resolution">
                  <select id="resolution" className={inputClass} value={resolution} onChange={(event) => setResolution(event.target.value)}>
                    <option value="original">Original</option>
                    <option value="1080">1080p</option>
                    <option value="720">720p</option>
                  </select>
                </Field>
                <Button className="w-full" onClick={() => convert(job.id, {
                  audioTrack: audioTrack !== '' ? audioTrack : job.audioTracks?.[0]?.index,
                  resolution,
                })}>
                  Convert video
                </Button>
              </div>
            ) : null}
            {['queued', 'downloading', 'analyzing', 'awaiting_options', 'converting'].includes(job.status) ? (
              <Button className="mt-4 w-full" variant="secondary" onClick={cancel}>Cancel</Button>
            ) : null}
          </Panel>
        ) : null}

        {job?.status === 'done' ? (
          <Panel className="mt-5 p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Conversion complete
            </p>
            {sentToRoom && roomId ? (
              <>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {roomReceived
                    ? 'The video is now playing in the room.'
                    : 'The video was sent to the room tab. Switch back to see it.'}
                </p>
                <Button className="mt-4 w-full" onClick={closeTab}>
                  <X className="h-4 w-4" /> Close this tab
                </Button>
                {!roomReceived ? (
                  <Button className="mt-2 w-full" variant="secondary" onClick={share} disabled={roomCode.length < 4}>
                    Open room {roomCode || '…'} instead
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Field className="mt-4" label="Room code" htmlFor="share-room" hint="Enter the room where you want to share this video.">
                  <input
                    id="share-room"
                    className={inputClass}
                    value={roomCode}
                    onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                    maxLength={6}
                    placeholder="ABC123"
                  />
                </Field>
                <Button className="mt-4 w-full" onClick={share} disabled={roomCode.length < 4}>
                  Share to room
                </Button>
              </>
            )}
          </Panel>
        ) : null}

        {job?.status === 'failed' || error ? (
          <div role="alert" className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error || job.error || job.message}
          </div>
        ) : null}
        {job?.status === 'cancelled' ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><XCircle className="h-4 w-4" /> Conversion cancelled.</p>
        ) : null}
      </div>
    </main>
  );
}
