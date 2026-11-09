import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

function toListMessage(message) {
  return {
    id: message.id || `${message.room_id}-${message.created_at}-${Math.random()}`,
    room_id: message.room_id,
    name: message.name || 'Guest',
    text: message.text || '',
    created_at: message.created_at || new Date().toISOString(),
    type: message.type || 'chat',
    user_id: message.user_id || message.name || 'guest',
  };
}

export function useChat({ roomId, channel, displayName, userId }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!roomId || !channel) {
      return;
    }

    const handleMessage = ({ payload }) => {
      if (!payload) {
        return;
      }

      const message = toListMessage({
        ...payload,
        user_id: payload.user_id || payload.name || 'guest',
        room_id: roomId,
        created_at: payload.created_at || new Date().toISOString(),
      });

      setMessages((current) => [...current, message].slice(-100));
    };

    const handleNotice = ({ payload }) => {
      if (!payload?.text) {
        return;
      }

      const notice = {
        id: `notice-${Date.now()}-${Math.random()}`,
        room_id: roomId,
        name: 'System',
        text: payload.text,
        created_at: new Date().toISOString(),
        type: 'system',
        user_id: 'system',
      };
      setMessages((current) => [...current, notice].slice(-100));
    };

    channel.on('broadcast', { event: 'chat:message' }, handleMessage);
    channel.on('broadcast', { event: 'chat:notice' }, handleNotice);

    return () => {
      if (typeof channel.off === 'function') {
        channel.off('broadcast', { event: 'chat:message' }, handleMessage);
        channel.off('broadcast', { event: 'chat:notice' }, handleNotice);
      }
    };
  }, [channel, roomId]);

  useEffect(() => {
    if (!roomId || !supabase) {
      return;
    }

    const loadHistory = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) {
        return;
      }

      setMessages((data || []).map(toListMessage).slice(-100));
    };

    loadHistory();

    const subscription = supabase
      .channel(`messages:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const nextMessage = toListMessage(payload.new);
          setMessages((current) => [...current, nextMessage].slice(-100));
        },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [roomId]);

  const addSystemMessage = (text) => {
    if (!text?.trim()) {
      return;
    }

    const systemMessage = {
      id: `system-${Date.now()}-${Math.random()}`,
      room_id: roomId,
      name: 'System',
      text,
      created_at: new Date().toISOString(),
      type: 'system',
      user_id: 'system',
    };

    setMessages((current) => [...current, systemMessage].slice(-100));
  };

  const sendMessage = async (rawMessage) => {
    const messageText = String(rawMessage || '').trim();
    if (!messageText) {
      return;
    }

    const cleanedText = messageText.slice(0, 500);
    const payload = {
      room_id: roomId,
      name: displayName || 'Guest',
      text: cleanedText,
      created_at: new Date().toISOString(),
      user_id: userId,
    };

    const showLocalFallback = () => {
      if (channel) {
        channel.send({
          type: 'broadcast',
          event: 'chat:message',
          payload,
        });
      }

      setMessages((current) => [
        ...current,
        toListMessage({ ...payload, id: `local-fallback-${Date.now()}-${Math.random()}` }),
      ].slice(-100));
    };

    if (supabase) {
      try {
        const { error } = await supabase.from('messages').insert([
          {
            room_id: roomId,
            name: displayName || 'Guest',
            text: cleanedText,
          },
        ]);
        if (error) {
          showLocalFallback();
        }
      } catch (error) {
        showLocalFallback();
      }
    }
  };

  return {
    messages,
    sendMessage,
    addSystemMessage,
  };
}
