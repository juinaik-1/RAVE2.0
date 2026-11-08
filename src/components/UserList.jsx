export default function UserList({ users, hostId, currentUserId, speakingUsers = [] }) {
  const speakingSet = new Set(speakingUsers);

  return (
    <div className="user-panel">
      <div className="section-header">
        <h3>People</h3>
      </div>

      <div className="user-list">
        {users.map((user) => {
          const isHost = user.userId === hostId;
          const isCurrent = user.userId === currentUserId;
          const isSpeaking = speakingSet.has(user.userId) || user.isVoice;

          return (
            <div className="user-item" key={user.userId || user.name}>
              <div className="user-main">
                <div className="user-avatar">{(user.name || 'G').charAt(0).toUpperCase()}</div>
                <div>
                  <div className="user-name">
                    {user.name || 'Guest'}
                    {isCurrent ? ' (You)' : ''}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isHost ? <span className="badge host">Host</span> : null}
                {user.isVoice ? <span className="badge voice">Voice</span> : null}
                {isSpeaking ? <span className="speaking-dot" title="Speaking" /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
