import { Copy, Crown, Users } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, Panel, PanelHeader, Skeleton } from './ui';
import { cn } from '../utils/cn';

export default function UserList({
  users,
  hostId,
  currentUserId,
  speakingUsers = [],
  isConnected = true,
  connectionStatus = 'connected',
  onInvite,
  onTransferHost,
}) {
  const speakingSet = new Set(speakingUsers);
  const showSkeletons = !isConnected && !users.length && connectionStatus === 'connecting';

  return (
    <Panel>
      <PanelHeader title="People" meta={<Badge>{users.length}</Badge>} />

      <div className="p-2">
        {showSkeletons ? (
          <div className="space-y-1" aria-label="Loading people">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        ) : users.length ? (
          <div className="flex flex-col gap-0.5">
            {users.map((user) => {
              const isHost = user.userId === hostId;
              const isCurrent = user.userId === currentUserId;
              const isSpeaking = speakingSet.has(user.userId) || user.isVoice;

              return (
                <div
                  key={user.userId || user.name}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors duration-150 ease-out hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative shrink-0">
                      <Avatar
                        name={user.name}
                        size="md"
                        className={cn(
                          isSpeaking &&
                            'ring-2 ring-emerald-500/40 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900',
                        )}
                      />
                      {isSpeaking ? (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900"
                          title="Speaking"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {user.name || 'Guest'}
                        </span>
                        {isCurrent ? (
                          <span className="shrink-0 text-2xs text-zinc-500 dark:text-zinc-400">
                            You
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-2xs text-zinc-500 dark:text-zinc-400">
                        {isHost ? 'Host' : user.isVoice ? 'In voice' : 'Watching'}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isHost ? (
                      <Badge tone="warning">
                        <Crown className="h-3 w-3" strokeWidth={1.75} />
                        Host
                      </Badge>
                    ) : null}
                    {user.isVoice && !isHost ? (
                      <Badge tone="success" dot>
                        Voice
                      </Badge>
                    ) : null}
                    {currentUserId === hostId && !isCurrent && onTransferHost ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onTransferHost(user.userId)}
                        aria-label={`Make ${user.name || 'participant'} the host`}
                      >
                        Make host
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            compact
            icon={Users}
            title={connectionStatus === 'error' || connectionStatus === 'disconnected'
              ? 'Room connection failed' : "It's quiet in here"}
            description={connectionStatus === 'error' || connectionStatus === 'disconnected'
              ? 'Realtime presence is unavailable. Check your connection and reload the room.'
              : 'Share the invite link to bring people into the room.'}
            action={
              onInvite ? (
                <Button variant="secondary" size="sm" onClick={onInvite}>
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Copy invite link
                </Button>
              ) : null
            }
          />
        )}
      </div>
    </Panel>
  );
}
