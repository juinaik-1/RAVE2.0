import { Headphones, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { Avatar, Badge, Button, Callout, EmptyState, Panel, PanelHeader } from './ui';

export default function VoicePanel({
  isJoined,
  isMuted,
  error,
  remoteUsers,
  joinVoice,
  leaveVoice,
  toggleMute,
  setRemoteVolume,
}) {
  return (
    <Panel>
      <PanelHeader
        title="Voice"
        meta={
          <Badge tone={isJoined ? (isMuted ? 'warning' : 'success') : 'neutral'} dot>
            {isJoined ? (isMuted ? 'Muted' : 'Live') : 'Off'}
          </Badge>
        }
      />

      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          {!isJoined ? (
            <>
              <Button size="sm" onClick={joinVoice}>
                <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
                Join voice
              </Button>
              <span className="text-2xs text-zinc-500 dark:text-zinc-400">
                Optional · headphones recommended
              </span>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant={isMuted ? 'primary' : 'secondary'}
                onClick={toggleMute}
                aria-pressed={isMuted}
              >
                {isMuted ? (
                  <MicOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Mic className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                {isMuted ? 'Unmute' : 'Mute'}
              </Button>
              <Button size="sm" variant="danger" onClick={leaveVoice}>
                <PhoneOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                Leave
              </Button>

              <span className="ml-auto text-2xs text-zinc-500 dark:text-zinc-400">
                {remoteUsers.length} {remoteUsers.length === 1 ? 'person' : 'people'} connected
              </span>
            </>
          )}
        </div>

        {isJoined && isMuted ? <Callout tone="info">Microphone is muted.</Callout> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}

        {remoteUsers.length ? (
          <div className="border-t border-zinc-200/80 pt-2 dark:border-zinc-800">
            <p className="px-1 pb-1 text-2xs font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              In voice
            </p>
            <div className="flex flex-col gap-0.5">
              {remoteUsers.map((user) => (
                <div
                  key={user.peerId}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 ease-out hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={user.name} size="sm" />
                    <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                      {user.name || 'Guest'}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Volume2
                      className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"
                      strokeWidth={1.75}
                    />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={user.volume ?? 1}
                      onChange={(event) =>
                        setRemoteVolume(user.peerId, Number(event.target.value))
                      }
                      aria-label={`Volume for ${user.name || 'Guest'}`}
                      className="volume-range w-20"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : isJoined ? (
          <div className="border-t border-zinc-200/80 pt-1 dark:border-zinc-800">
            <EmptyState
              compact
              icon={Headphones}
              title="No one else is in voice"
              description="Invite someone to join the call."
            />
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-md border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-2xs leading-4 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
          <Headphones className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>Use headphones to avoid echo during voice chat.</span>
        </div>
      </div>
    </Panel>
  );
}
