import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { escapePlainText } from '../utils/videoUrl';
import { Avatar, Badge, Button, EmptyState, PanelHeader, textareaClass } from './ui';
import { cn } from '../utils/cn';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function formatTimestamp(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isContinuation(message, previous) {
  if (!previous || previous.type === 'system' || message.type === 'system') {
    return false;
  }

  if (previous.user_id !== message.user_id) {
    return false;
  }

  if ((previous.name || '') !== (message.name || '')) {
    return false;
  }

  const currentTime = new Date(message.created_at).getTime();
  const previousTime = new Date(previous.created_at).getTime();

  if (!Number.isFinite(currentTime) || !Number.isFinite(previousTime)) {
    return false;
  }

  return currentTime - previousTime < GROUP_WINDOW_MS;
}

export default function Chat({ messages, onSendMessage, currentUserId, displayName, className }) {
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const [draftLength, setDraftLength] = useState(0);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const value = inputRef.current?.value || '';

    if (!value.trim()) {
      return;
    }

    onSendMessage(value);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
    setDraftLength(0);
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  const focusComposer = () => inputRef.current?.focus();

  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200/80 bg-white shadow-card dark:border-zinc-800 dark:bg-zinc-900',
        className,
      )}
    >
      <PanelHeader
        title="Chat"
        meta={<Badge>{messages.length}</Badge>}
        className="shrink-0"
      />

      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length ? (
          <div className="flex flex-col gap-0.5">
            {messages.map((message, index) => {
              const isOwn = message.name === displayName && message.user_id === currentUserId;
              const isSystem = message.type === 'system';
              const continuation = isContinuation(message, messages[index - 1]);

              if (isSystem) {
                return (
                  <div
                    key={message.id || `system-${index}`}
                    className="flex items-center gap-2 px-1 py-2"
                  >
                    <div className="h-px flex-1 bg-zinc-200/80 dark:bg-zinc-800" />
                    <p className="max-w-[75%] text-center text-2xs leading-4 text-zinc-500 dark:text-zinc-400">
                      {escapePlainText(message.text || '')}
                    </p>
                    <div className="h-px flex-1 bg-zinc-200/80 dark:bg-zinc-800" />
                  </div>
                );
              }

              return (
                <div
                  key={message.id || `${message.name}-${message.created_at}-${index}`}
                  className={cn(
                    'group rounded-md px-2 transition-colors duration-150 ease-out hover:bg-zinc-50 dark:hover:bg-zinc-800/40',
                    continuation ? 'py-0.5' : 'mt-1 py-1.5',
                  )}
                >
                  <div className="flex gap-3">
                    <div className="w-7 shrink-0">
                      {continuation ? null : <Avatar name={message.name} size="sm" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      {continuation ? null : (
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                            {escapePlainText(message.name || 'Guest')}
                          </span>
                          {isOwn ? (
                            <span className="shrink-0 text-2xs font-medium text-indigo-600 dark:text-indigo-400">
                              You
                            </span>
                          ) : null}
                          <time className="ml-auto shrink-0 text-2xs text-zinc-500 dark:text-zinc-400">
                            {formatTimestamp(message.created_at)}
                          </time>
                        </div>
                      )}

                      <p
                        className={cn(
                          'whitespace-pre-wrap break-words text-sm leading-5 text-zinc-600 dark:text-zinc-300',
                          continuation ? 'mt-0' : 'mt-0.5',
                        )}
                      >
                        {escapePlainText(message.text || '')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description="Say hello to start the conversation."
            className="h-full"
            action={
              <Button variant="secondary" size="sm" onClick={focusComposer}>
                Write a message
              </Button>
            }
          />
        )}
      </div>

      <form
        className="shrink-0 border-t border-zinc-200/80 p-3 dark:border-zinc-800"
        onSubmit={handleSubmit}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            className={cn(textareaClass, 'max-h-24 min-h-9 flex-1')}
            rows={1}
            maxLength={500}
            placeholder="Send a message"
            aria-label="Message"
            onChange={(event) => setDraftLength(event.target.value.length)}
            onKeyDown={handleComposerKeyDown}
          />
          <Button type="submit" size="icon" aria-label="Send message">
            <Send className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-2xs text-zinc-500 dark:text-zinc-400">
          <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line</span>
          <span
            className={cn(
              'ml-auto tabular-nums',
              draftLength >= 400 && 'font-medium text-zinc-600 dark:text-zinc-300',
            )}
          >
            {draftLength > 0 ? `${draftLength}/500` : ''}
          </span>
        </div>
      </form>
    </aside>
  );
}
