// Cross-tab helpers so a conversion can run in its own tab while the room tab
// keeps playing, and hand the finished video back to the room automatically.

const CHANNEL_NAME = 'nook:room-bridge';
const MESSAGE_TYPE = 'video:converted';
const ACK_TYPE = 'video:converted:ack';
// The room tab that started a conversion identifies itself with this id so
// exactly one room applies the result.
export const CONVERT_REQUEST_KEY = 'Nook-convert-request';
// Messages can arrive twice (broadcast channel plus the opener window), so
// every id is only handled once per tab.
const seen = new Set();

let channel = null;
let channelFailed = false;
const handlers = new Set();
const ackHandlers = new Set();

function getChannel() {
  if (channelFailed) return null;
  if (channel) return channel;
  try {
    if (typeof BroadcastChannel !== 'function') {
      channelFailed = true;
      return null;
    }
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => deliver(event.data);
    return channel;
  } catch {
    channelFailed = true;
    return null;
  }
}

function deliver(message) {
  if (!message || typeof message.type !== 'string') return;
  if (message.type !== MESSAGE_TYPE && message.type !== ACK_TYPE) return;
  // A message can arrive over both the broadcast channel and a direct window
  // post, so each id is only handled once.
  if (seen.has(message.id)) return;
  seen.add(message.id);
  const list = message.type === ACK_TYPE ? ackHandlers : handlers;
  list.forEach((handler) => {
    try {
      handler(message);
    } catch {
      /* ignore */
    }
  });
}

function post(message, targetWindow) {
  const active = getChannel();
  if (active) {
    try {
      active.postMessage(message);
    } catch {
      /* ignore */
    }
  }
  try {
    // The opener fallback only reaches the room tab when the conversion tab
    // sends the message; replies need an explicit target.
    const target = targetWindow || window.opener;
    target?.postMessage(message, window.location.origin);
  } catch {
    /* ignore */
  }
}

function readStored(kind, key) {
  try {
    return window[kind].getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStored(kind, key, value) {
  try {
    window[kind].setItem(key, value);
  } catch {
    /* ignore */
  }
}

function requestStorageKey(roomId) {
  return `${CONVERT_REQUEST_KEY}:${roomId}`;
}

// A stable id for this tab's conversion request.
export function getConvertRequestId(roomId) {
  const key = requestStorageKey(roomId);
  const fromSession = readStored('sessionStorage', key);
  if (fromSession) return fromSession;
  const fromLocal = readStored('localStorage', key);
  if (fromLocal) {
    writeStored('sessionStorage', key, fromLocal);
    return fromLocal;
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  writeStored('sessionStorage', key, id);
  writeStored('localStorage', key, id);
  return id;
}

// Open the conversion page in a separate tab so the room keeps running.
export function openConvertTab({ roomId, requestId, streamId, name }) {
  const params = new URLSearchParams();
  if (roomId) params.set('room', roomId);
  if (requestId) params.set('request', requestId);
  if (streamId) params.set('stream', streamId);
  if (name) params.set('name', name);
  const url = `/convert?${params.toString()}`;
  // The tab keeps a reference to the room tab so the finished video can be
  // handed back and the room tab can be focused again.
  const opened = window.open(url, '_blank');
  if (!opened) {
    // Popup blocked: fall back to the current tab.
    window.location.assign(url);
  }
  return opened;
}

// Send a converted video to the room tab that asked for it.
export function publishConvertedVideo(payload) {
  const message = {
    type: MESSAGE_TYPE,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: Date.now(),
    ...payload,
  };
  post(message);
  return message;
}

// Confirm that the room tab received the video.
export function acknowledgeConvertedVideo(messageId, payload = {}, targetWindow) {
  post({
    type: ACK_TYPE,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: Date.now(),
    ackFor: messageId,
    ...payload,
  }, targetWindow);
}

// Listen for converted videos sent from another tab.
export function subscribeConvertedVideo(handler) {
  handlers.add(handler);
  getChannel();
  const onWindowMessage = (event) => {
    if (event.origin !== window.location.origin) return;
    deliver(event.data);
  };
  window.addEventListener('message', onWindowMessage);
  return () => {
    handlers.delete(handler);
    window.removeEventListener('message', onWindowMessage);
  };
}

// Listen for the room tab acknowledging a converted video.
export function subscribeConvertedVideoAck(handler) {
  ackHandlers.add(handler);
  getChannel();
  return () => {
    ackHandlers.delete(handler);
  };
}
