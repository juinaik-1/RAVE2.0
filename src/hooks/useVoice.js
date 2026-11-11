import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const TURN_URL = import.meta.env.VITE_TURN_URL;
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME || '';
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL || '';

function getIceServers() {
  const servers = [...ICE_SERVERS];

  if (TURN_URL) {
    servers.push({
      urls: TURN_URL,
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    });
  }

  return servers;
}

export function useVoice({ roomId, channel, userId, displayName, presenceUsers, isConnected, updatePresence }) {
  const [isJoined, setIsJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState('');
  const [remoteUsers, setRemoteUsers] = useState([]);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamsRef = useRef({});

  const removeRemoteUser = (peerId) => {
    const current = remoteStreamsRef.current[peerId];

    if (current?.audio) {
      current.audio.pause();
      current.audio.srcObject = null;
      current.audio.remove();
    }

    delete remoteStreamsRef.current[peerId];
    setRemoteUsers((items) => items.filter((item) => item.peerId !== peerId));
  };

  const setRemoteVolume = (peerId, volume) => {
    const current = remoteStreamsRef.current[peerId];
    if (current?.audio) {
      current.audio.volume = volume;
    }

    setRemoteUsers((items) =>
      items.map((item) => (item.peerId === peerId ? { ...item, volume } : item)),
    );
  };

  const leaveVoice = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    Object.keys(remoteStreamsRef.current).forEach((peerId) => removeRemoteUser(peerId));

    if (channel && isConnected) {
      updatePresence({ isVoice: false, peerId: null });
    }

    setIsJoined(false);
    setIsMuted(false);
    setError('');
  };

  useEffect(() => {
    return () => {
      leaveVoice();
    };
  }, [roomId]);

  useEffect(() => {
    if (!isJoined || !peerRef.current || !localStreamRef.current || !presenceUsers.length) {
      return;
    }

    const currentPeerId = `${roomId}-${userId}`;

    presenceUsers.forEach((user) => {
      if (!user.isVoice || !user.peerId || user.userId === userId || user.peerId === currentPeerId) {
        return;
      }

      if (remoteStreamsRef.current[user.peerId]) {
        return;
      }

      const call = peerRef.current.call(user.peerId, localStreamRef.current);
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.style.display = 'none';
      audio.muted = false;
      document.body.appendChild(audio);

      call.on('stream', (remoteStream) => {
        audio.srcObject = remoteStream;
        audio.volume = 1;

        const nextEntry = {
          peerId: user.peerId,
          userId: user.userId,
          name: user.name || 'Guest',
          volume: 1,
        };

        remoteStreamsRef.current[user.peerId] = { audio, peerId: user.peerId, userId: user.userId };
        setRemoteUsers((items) => {
          const filtered = items.filter((item) => item.peerId !== user.peerId);
          return [...filtered, nextEntry];
        });
      });

      call.on('close', () => removeRemoteUser(user.peerId));
      call.on('error', () => removeRemoteUser(user.peerId));
    });
  }, [isJoined, presenceUsers, roomId, userId]);

  const joinVoice = async () => {
    if (!roomId || !navigator.mediaDevices?.getUserMedia) {
      setError('Voice chat is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = stream;
      const peerId = `${roomId}-${userId}`;
      const peer = new Peer(peerId, {
        config: { iceServers: getIceServers() },
      });
      peerRef.current = peer;

      peer.on('open', () => {
        setIsJoined(true);
        setError('');
        if (channel && isConnected) {
          updatePresence({ isVoice: true, peerId });
        }
      });

      peer.on('call', (call) => {
        call.answer(stream);

        call.on('stream', (remoteStream) => {
          const remotePeerId = call.peer;
          const audio = document.createElement('audio');
          audio.autoplay = true;
          audio.playsInline = true;
          audio.style.display = 'none';
          audio.srcObject = remoteStream;
          audio.volume = 1;
          document.body.appendChild(audio);

          const matchingUser = presenceUsers.find((item) => item.peerId === remotePeerId);
          remoteStreamsRef.current[remotePeerId] = {
            audio,
            peerId: remotePeerId,
            userId: matchingUser?.userId || remotePeerId,
          };

          setRemoteUsers((items) => {
            const filtered = items.filter((item) => item.peerId !== remotePeerId);
            return [
              ...filtered,
              {
                peerId: remotePeerId,
                userId: matchingUser?.userId || remotePeerId,
                name: matchingUser?.name || 'Guest',
                volume: 1,
              },
            ];
          });
        });

        call.on('close', () => removeRemoteUser(call.peer));
        call.on('error', () => removeRemoteUser(call.peer));
      });

      peer.on('error', (event) => {
        console.error('Peer connection error', event);
        setError('Voice chat could not connect. This could be caused by browser permissions or a restricted network.');
      });
    } catch (event) {
      const message = event?.message || 'Microphone access was denied.';
      setError(`Microphone access was denied. Please allow the mic and try again. ${message}`);
    }
  };

  const toggleMute = () => {
    if (!localStreamRef.current) {
      return;
    }

    const nextMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  };

  return {
    isJoined,
    isMuted,
    error,
    remoteUsers,
    joinVoice,
    leaveVoice,
    toggleMute,
    setRemoteVolume,
  };
}
