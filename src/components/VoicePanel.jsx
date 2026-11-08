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
    <div className="voice-panel">
      <div className="section-header">
        <h3>Voice chat</h3>
      </div>

      <div className="voice-actions">
        {!isJoined ? (
          <button type="button" className="primary-btn" onClick={joinVoice}>
            Join voice
          </button>
        ) : (
          <button type="button" className="warning-btn" onClick={leaveVoice}>
            Leave voice
          </button>
        )}

        {isJoined ? (
          <button type="button" className="secondary-btn" onClick={toggleMute}>
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
        ) : null}
      </div>

      {isJoined && isMuted ? <div className="muted-note">Microphone is muted.</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {remoteUsers.length ? (
        <div className="remote-user-list" style={{ marginTop: 12 }}>
          {remoteUsers.map((user) => (
            <div key={user.peerId} className="user-item">
              <div className="user-main">
                <div className="user-avatar">{(user.name || 'G').charAt(0).toUpperCase()}</div>
                <div>
                  <div className="user-name">{user.name || 'Guest'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '110px' }}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={user.volume ?? 1}
                  onChange={(event) => setRemoteVolume(user.peerId, Number(event.target.value))}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="voice-tip">Tip: use headphones to avoid echo during voice chat.</div>
    </div>
  );
}
