import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';

const BLOCKED_NETWORKS = [
  '10.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1',
  'fc00::/7',
  'fe80::/10',
];

function ipToBigInt(ip) {
  const parsed = ip.includes(':') ? ip : ip.split('.');
  if (parsed === ip) {
    const [high, low] = ip.split('::');
    const groups = high ? high.split(':').filter(Boolean) : [];
    const raw = [...groups, ...Array(8 - groups.length).fill('0')];
    const expanded = raw.map((value) => value.padStart(4, '0')).join('');
    return BigInt('0x' + expanded);
  }

  let value = 0n;
  for (const octet of parsed) {
    value = (value << 8n) + BigInt(Number(octet));
  }
  return value;
}

function isBlockedAddress(address) {
  if (!address) {
    return true;
  }

  const ip = address.trim();
  if (ip.includes(':')) {
    const ipv6 = ip.split('%')[0];
    if (ipv6 === '::1') {
      return true;
    }
    return BLOCKED_NETWORKS.some((network) => {
      if (!network.includes(':')) {
        return false;
      }
      const [networkIp, prefixLengthText] = network.split('/');
      const prefixLength = Number(prefixLengthText || 128);
      const networkValue = ipToBigInt(networkIp);
      const targetValue = ipToBigInt(ipv6);
      const shift = 128n - BigInt(prefixLength);
      return (networkValue === (targetValue >> shift << shift));
    });
  }

  const parts = ip.split('.');
  if (parts.length !== 4) {
    return true;
  }

  const target = parts.map((part) => Number(part)).join('.');
  if (target === '127.0.0.1') {
    return true;
  }

  return BLOCKED_NETWORKS.some((network) => {
    if (network.includes(':')) {
      return false;
    }
    const [networkIp, prefixText] = network.split('/');
    const prefix = Number(prefixText || 32);
    const targetValue = ipToBigInt(ip);
    const networkValue = ipToBigInt(networkIp);
    const shift = 32n - BigInt(prefix);
    return (networkValue === (targetValue >> shift << shift));
  });
}

export function isValidJobId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9]+$/.test(value);
}

export function isValidMp4Name(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9.-]+\.mp4$/i.test(value);
}

export function validateApiKey(candidate, expected) {
  if (!candidate || !expected) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
}

export function validateUrl(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('A media URL is required.');
  }

  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP or HTTPS uploads are allowed.');
  }

  return parsed;
}

export async function resolveTargetAndBlockPrivateHosts(urlValue) {
  const parsed = validateUrl(urlValue);
  const addresses = await dns.lookup(parsed.hostname, { all: true });

  if (!addresses || !addresses.length) {
    throw new Error('The host could not be resolved.');
  }

  for (const addressInfo of addresses) {
    if (isBlockedAddress(addressInfo.address)) {
      throw new Error('The target URL resolves to a private or blocked network address.');
    }
  }

  return {
    parsed,
    resolvedIps: addresses.map((item) => item.address),
  };
}

export function ensureFreeDiskSpace(requiredBytes) {
  try {
    const stats = fs.statfsSync('/');
    const availableBytes = stats.bavail * stats.bsize;
    const requestedBytes = Number(requiredBytes || 0);
    const safetyBufferBytes = 512 * 1024 * 1024;
    const minimumRequired = Math.max(requestedBytes, safetyBufferBytes);

    if (minimumRequired > 0 && availableBytes < minimumRequired) {
      throw new Error('Not enough free disk space to download and convert this file.');
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}
