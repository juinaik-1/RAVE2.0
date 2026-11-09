export function normalizeVideoUrl(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }

  const value = rawValue.trim();

  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value) === false) {
    return null;
  }

  try {
    const url = new URL(value);

    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    if (host.includes('drive.google.com')) {
      const match = value.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]+)/i);
      const fileId = match?.[1];

      if (!fileId) {
        return null;
      }

      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }

    if (host.includes('youtu.be') || host.includes('youtube.com')) {
      return value;
    }

    if (
      pathname.endsWith('.mp4') ||
      pathname.endsWith('.webm') ||
      pathname.endsWith('.ogg') ||
      pathname.endsWith('.mov') ||
      pathname.endsWith('.m4v') ||
      pathname.endsWith('.m3u8')
    ) {
      return value;
    }

    return value;
  } catch (error) {
    return null;
  }
}

export function isDirectPlayableVideo(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.toLowerCase();
    const search = url.search.toLowerCase();
    const hasVideoExtension =
      pathname.endsWith('.mp4') ||
      pathname.endsWith('.webm') ||
      pathname.endsWith('.ogg') ||
      pathname.endsWith('.m3u8') ||
      pathname.endsWith('.mov') ||
      pathname.endsWith('.m4v') ||
      pathname.endsWith('.m4a') ||
      pathname.endsWith('.mp3');

    const hasVideoQueryHint =
      search.includes('video/mp4') ||
      search.includes('video/webm') ||
      search.includes('video/quicktime') ||
      search.includes('mime=video');

    return hasVideoExtension || hasVideoQueryHint;
  } catch (error) {
    return false;
  }
}

export function isGoogleDriveLink(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.hostname.toLowerCase().includes('drive.google.com');
  } catch (error) {
    return false;
  }
}

export function escapePlainText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
