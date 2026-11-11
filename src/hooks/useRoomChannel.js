import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { supabase } from '../supabase';

const PARTICIPANT_ID_KEY = 'Nook-participant-id';
// How long to keep the current host when their presence briefly disappears (e.g. a
// page reload) before promoting someone else. The room owner skips this and reclaims
// the role immediately.
const HOST_GRACE_MS = 6000;

function createParticipantId() {
  if (typeof window === 'undefined') return `guest-${Date.now()}`;
  const makeId = () => {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return `guest-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  };
  // Persist per tab so a reload keeps the same identity (and seniority).
  try {
    const existing = window.sessionStorage.getItem(PARTICIPANT_ID_KEY);
    if (existing) return existing;
    const id = makeId();
    window.sessionStorage.setItem(PARTICIPANT_ID_KEY, id);
    return id;
  } catch {
    return makeId();
  }
}

export function useRoomChannel(roomId, displayName, isOwner = false) {
  const [channel, setChannel] = useState(null);
  const [presenceUsers, setPresenceUsers] = useState([]);
  const [hostId, setHostId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const userIdRef = useRef(null);
  if (!userIdRef.current) userIdRef.current = createParticipantId();
  const channelRef = useRef(null);
  const hostIdRef = useRef(null);
  const hostGraceRef = useRef(0);
  const manualHostRef = useRef(null);
  const isOwnerRef = useRef(Boolean(isOwner));
  isOwnerRef.current = Boolean(isOwner);
  const [, forceHostTick] = useReducer((value) => value + 1, 0);
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;
  // Remember an explicit host transfer across reloads so the delegated host keeps the
  // role instead of the owner instantly reclaiming it on the next presence sync.
  const delegateKey = `Nook-host-delegate:${roomId}`;
  const readDelegate = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(delegateKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [delegateKey]);
  const writeDelegate = useCallback((value) => {
    if (typeof window === 'undefined') return;
    try {
      if (value) window.sessionStorage.setItem(delegateKey, JSON.stringify(value));
      else window.sessionStorage.removeItem(delegateKey);
    } catch {
      /* ignore */
    }
  }, [delegateKey]);
  const initialDelegate = readDelegate();
  const amInitialDelegate = initialDelegate?.targetUserId === userIdRef.current;
  const presenceRef = useRef(null);
  if (!presenceRef.current) {
    presenceRef.current = {
      userId: userIdRef.current,
      name: displayName || 'Guest',
      joinedAt: Date.now(),
      isHost: amInitialDelegate,
      isOwner: isOwnerRef.current,
      hostViaTransfer: amInitialDelegate,
      hostViaTransferAt: amInitialDelegate ? Number(initialDelegate?.at || 0) : 0,
      hostOnlyControls: amInitialDelegate ? Boolean(initialDelegate?.hostOnlyControls) : false,
      isVoice: false,
      peerId: null,
    };
  }

  useEffect(() => {
    setPresenceUsers([]);
    setHostId(null);
    hostIdRef.current = null;
    manualHostRef.current = null;
    setIsConnected(false);
    setConnectionStatus('connecting');
    setChannel(null);
    channelRef.current = null;
    presenceRef.current = {
      userId: userIdRef.current,
      name: displayNameRef.current || 'Guest',
      joinedAt: Date.now(),
      isHost: amInitialDelegate,
      isOwner: isOwnerRef.current,
      hostViaTransfer: amInitialDelegate,
      hostViaTransferAt: amInitialDelegate ? Number(initialDelegate?.at || 0) : 0,
      hostOnlyControls: amInitialDelegate ? Boolean(initialDelegate?.hostOnlyControls) : false,
      isVoice: false,
      peerId: null,
    };
    if (!roomId || !supabase) {
      setConnectionStatus('error');
      return undefined;
    }

    let active = true;
    const nextChannel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { ack: true },
        presence: { key: userIdRef.current },
      },
    });
    channelRef.current = nextChannel;

    nextChannel.on('presence', { event: 'sync' }, () => {
      if (!active) return;
      const usersById = new Map();
      for (const [presenceKey, entries] of Object.entries(nextChannel.presenceState())) {
        (entries || []).forEach((entry, index) => {
          const userId = entry.userId || (index ? `${presenceKey}:${index}` : presenceKey);
          usersById.set(userId, {
            userId,
            name: entry.name || 'Guest',
            joinedAt: entry.joinedAt || Date.now(),
            isHost: Boolean(entry.isHost),
            isOwner: Boolean(entry.isOwner),
            hostViaTransfer: Boolean(entry.hostViaTransfer),
            hostOnlyControls: Boolean(entry.hostOnlyControls),
            isVoice: Boolean(entry.isVoice),
            peerId: entry.peerId || null,
          });
        });
      }
      setPresenceUsers([...usersById.values()].sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt)));
    });

    nextChannel.subscribe((status) => {
      if (!active) return;
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        setConnectionStatus('connected');
        const trackResult = nextChannel.track(presenceRef.current);
        Promise.resolve(trackResult).then((result) => {
          if (result !== 'ok') console.error('Room presence tracking was not acknowledged.');
        }).catch((error) => console.error('Unable to publish room presence.', error));
      } else {
        setIsConnected(false);
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          setPresenceUsers([]);
          setHostId(null);
          hostIdRef.current = null;
          setConnectionStatus(status === 'CLOSED' ? 'disconnected' : 'error');
        } else {
          setConnectionStatus('connecting');
        }
      }
    });

    setChannel(nextChannel);
    return () => {
      active = false;
      if (channelRef.current === nextChannel) channelRef.current = null;
      setPresenceUsers([]);
      setHostId(null);
      hostIdRef.current = null;
      setIsConnected(false);
      setConnectionStatus('connecting');
      setChannel(null);
      void supabase.removeChannel(nextChannel).catch((error) => {
        console.error('Unable to remove the room channel.', error);
      });
    };
  }, [roomId]);

  useEffect(() => {
    presenceRef.current = {
      ...presenceRef.current,
      userId: userIdRef.current,
      name: displayName || 'Guest',
      isOwner: isOwnerRef.current,
    };
    const activeChannel = channelRef.current;
    if (activeChannel && isConnected) {
      Promise.resolve(activeChannel.track(presenceRef.current)).catch((error) => {
        console.error('Unable to update room presence.', error);
      });
    }
  }, [displayName, isConnected]);

  const updatePresence = useCallback((patch = {}) => {
    const nextState = {
      ...presenceRef.current,
      ...patch,
      userId: userIdRef.current,
      name: displayNameRef.current || 'Guest',
    };
    presenceRef.current = nextState;
    const activeChannel = channelRef.current;
    if (activeChannel && isConnected) {
      Promise.resolve(activeChannel.track(nextState)).catch((error) => {
        console.error('Unable to update room presence.', error);
      });
    }
  }, [isConnected]);

  useEffect(() => {
    if (!presenceUsers.length) {
      hostIdRef.current = null;
      hostGraceRef.current = 0;
      setHostId(null);
      return undefined;
    }

    const currentHostId = hostIdRef.current;
    const currentHostPresent = Boolean(currentHostId)
      && presenceUsers.some((user) => user.userId === currentHostId);
    if (currentHostPresent) hostGraceRef.current = Date.now();

    // Priority: an explicit transfer (local manual pick, or a peer's transfer flag) wins
    // while that participant is present, then the room creator (owner), then the earliest
    // joiner. `isHost` is only a display flag and never used to pick the host, so a
    // participant can't crown itself.
    const manualCandidate = manualHostRef.current
      ? presenceUsers.find((user) => user.userId === manualHostRef.current)
      : null;
    if (manualHostRef.current && !manualCandidate) manualHostRef.current = null;
    const delegate = presenceUsers.find((user) => user.hostViaTransfer);
    const owner = presenceUsers.find((user) => user.isOwner);
    const earliest = [...presenceUsers].sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt))[0];
    const nextHost = manualCandidate || delegate || owner || earliest;
    if (!nextHost) return undefined;

    if (nextHost.userId === currentHostId) {
      hostGraceRef.current = Date.now();
      return undefined;
    }

    // The owner or an explicit delegate takes over immediately; anyone else waits out a
    // short grace period so a reloading host doesn't lose the role to a guest.
    const privileged = nextHost.userId === owner?.userId
      || nextHost.userId === delegate?.userId
      || nextHost.userId === manualCandidate?.userId;
    if (!privileged && currentHostId && !currentHostPresent
        && Date.now() - hostGraceRef.current < HOST_GRACE_MS) {
      const remaining = HOST_GRACE_MS - (Date.now() - hostGraceRef.current);
      const timer = window.setTimeout(forceHostTick, remaining + 50);
      return () => window.clearTimeout(timer);
    }

    hostIdRef.current = nextHost.userId;
    hostGraceRef.current = Date.now();
    setHostId(nextHost.userId);
    const amHost = nextHost.userId === userIdRef.current;
    if (Boolean(presenceRef.current.isHost) !== amHost) {
      updatePresence({ isHost: amHost });
    }
    return undefined;
  }, [presenceUsers, updatePresence]);

  useEffect(() => {
    hostIdRef.current = hostId;
    if (!channel || !isConnected) return undefined;
    const handleTransfer = ({ payload }) => {
      if (!payload || payload.roomId !== roomId
          || payload.fromUserId !== hostIdRef.current
          || !presenceUsers.some((user) => user.userId === payload.targetUserId)) return;
      const isTarget = payload.targetUserId === userIdRef.current;
      if (isTarget) {
        writeDelegate({ targetUserId: userIdRef.current, hostOnlyControls: Boolean(payload.hostOnlyControls) });
      } else if (readDelegate()?.targetUserId === userIdRef.current) {
        writeDelegate(null);
      }
      manualHostRef.current = payload.targetUserId;
      hostIdRef.current = payload.targetUserId;
      hostGraceRef.current = Date.now();
      setHostId(payload.targetUserId);
      updatePresence({
        isHost: isTarget,
        hostViaTransfer: isTarget,
        hostOnlyControls: isTarget ? Boolean(payload.hostOnlyControls) : false,
      });
    };
    channel.on('broadcast', { event: 'room:host_transfer' }, handleTransfer);
    return () => channel.off?.('broadcast', { event: 'room:host_transfer' }, handleTransfer);
  }, [channel, hostId, isConnected, presenceUsers, roomId, updatePresence, readDelegate, writeDelegate]);

  const send = useCallback((event, payload = {}) => {
    const activeChannel = channelRef.current;
    if (!activeChannel || !isConnected) return;
    activeChannel.send({
      type: 'broadcast',
      event,
      payload: { roomId, ...payload },
    }).then((status) => {
      if (status !== 'ok') console.error(`Room broadcast ${event} was not acknowledged.`);
    }).catch((error) => {
      console.error(`Room broadcast ${event} failed.`, error);
    });
  }, [isConnected, roomId]);

  const transferHost = useCallback((targetUserId, hostOnlyControls = false) => {
    if (!channelRef.current || !isConnected || hostIdRef.current !== userIdRef.current
        || !presenceUsers.some((user) => user.userId === targetUserId)) return false;
    channelRef.current.send({
      type: 'broadcast',
      event: 'room:host_transfer',
      payload: { roomId, fromUserId: userIdRef.current, targetUserId, hostOnlyControls },
    }).then((status) => {
      if (status !== 'ok') console.error('Host transfer was not acknowledged.');
    }).catch((error) => console.error('Host transfer failed.', error));
    hostIdRef.current = targetUserId;
    hostGraceRef.current = Date.now();
    manualHostRef.current = targetUserId;
    if (readDelegate()?.targetUserId === userIdRef.current) writeDelegate(null);
    setHostId(targetUserId);
    updatePresence({ isHost: false, hostViaTransfer: false, hostOnlyControls: false });
    return true;
  }, [isConnected, presenceUsers, roomId, updatePresence, readDelegate, writeDelegate]);

  return {
    channel,
    presenceUsers,
    hostId,
    isConnected,
    connectionStatus,
    userId: userIdRef.current,
    send,
    updatePresence,
    transferHost,
  };
}
