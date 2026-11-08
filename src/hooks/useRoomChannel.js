import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';

const USER_ID_KEY = 'rave-user-id';

function getOrCreateUserId() {
  if (typeof window === 'undefined') {
    return `guest-${Math.random().toString(36).slice(2, 10)}`;
  }

  const stored = localStorage.getItem(USER_ID_KEY);
  if (stored) {
    return stored;
  }

  const generated = `user-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(USER_ID_KEY, generated);
  return generated;
}

export function useRoomChannel(roomId, displayName) {
  const [channel, setChannel] = useState(null);
  const [presenceUsers, setPresenceUsers] = useState([]);
  const [hostId, setHostId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const userIdRef = useRef(getOrCreateUserId());
  const presenceRef = useRef({
    userId: userIdRef.current,
    name: displayName || 'Guest',
    joinedAt: Date.now(),
    isVoice: false,
    peerId: null,
  });

  useEffect(() => {
    if (!roomId || !supabase) {
      return;
    }

    const nextChannel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { ack: true },
        presence: { key: 'userId' },
      },
    });

    nextChannel.on('presence', { event: 'sync' }, () => {
      const values = nextChannel.presenceState();
      const list = Object.entries(values).flatMap(([userId, entries]) => {
        const latest = entries?.[0] ?? {};
        return [{
          userId,
          name: latest.name || 'Guest',
          joinedAt: latest.joinedAt || Date.now(),
          isVoice: Boolean(latest.isVoice),
          peerId: latest.peerId || null,
        }];
      });

      setPresenceUsers(list.sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt)));
    });

    nextChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        presenceRef.current = {
          ...presenceRef.current,
          userId: userIdRef.current,
          name: displayName || 'Guest',
          joinedAt: Date.now(),
          isVoice: Boolean(presenceRef.current.isVoice),
        };
        nextChannel.track(presenceRef.current);
      }
    });

    setChannel(nextChannel);

    return () => {
      nextChannel.untrack();
      nextChannel.unsubscribe();
      setIsConnected(false);
      setChannel(null);
    };
  }, [roomId, displayName]);

  useEffect(() => {
    if (!presenceUsers.length) {
      setHostId(null);
      return;
    }

    const sorted = [...presenceUsers].sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt));
    setHostId(sorted[0]?.userId || null);
  }, [presenceUsers]);

  useEffect(() => {
    presenceRef.current = {
      ...presenceRef.current,
      userId: userIdRef.current,
      name: displayName || 'Guest',
    };

    if (channel && isConnected) {
      channel.track(presenceRef.current);
    }
  }, [displayName, channel, isConnected]);

  const updatePresence = (patch = {}) => {
    const nextState = {
      ...presenceRef.current,
      ...patch,
      userId: userIdRef.current,
      name: displayName || 'Guest',
    };

    presenceRef.current = nextState;

    if (channel && isConnected) {
      channel.track(nextState);
    }
  };

  const send = (event, payload = {}) => {
    if (!channel || !isConnected) {
      return;
    }

    channel.send({
      type: 'broadcast',
      event,
      payload: {
        roomId,
        ...payload,
      },
    });
  };

  return {
    channel,
    presenceUsers,
    hostId,
    isConnected,
    userId: userIdRef.current,
    send,
    updatePresence,
  };
}
