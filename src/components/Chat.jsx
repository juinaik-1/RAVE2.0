import { useEffect, useRef } from 'react';
import { escapePlainText } from '../utils/videoUrl';

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

export default function Chat({ messages, onSendMessage, currentUserId, displayName }) {
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

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
  };

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <h3>Chat</h3>
      </div>

      <div ref={scrollRef} className="chat-log">
        {messages.map((message) => {
          const isOwn = message.name === displayName && message.user_id === currentUserId;
          const isSystem = message.type === 'system';

          return (
            <div
              key={message.id || `${message.name}-${message.created_at}-${Math.random()}`}
              className={`chat-message ${isOwn ? 'own' : ''} ${isSystem ? 'system' : ''}`}
            >
              <div className="chat-meta">
                <span>{isSystem ? 'System' : escapePlainText(message.name || 'Guest')}</span>
                <span>{formatTimestamp(message.created_at)}</span>
              </div>
              <div className="chat-text">{escapePlainText(message.text || '')}</div>
            </div>
          );
        })}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="text-input"
          rows={2}
          maxLength={500}
          placeholder="Send a message"
        />
        <button type="submit" className="primary-btn">
          Send
        </button>
      </form>
    </aside>
  );
}
