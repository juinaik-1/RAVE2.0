import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { config } from './config.js';

const BLOCKED_IPV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function ipv4Number(address) {
  return address.split('.').reduce((value, part) => (value * 256) + Number(part), 0);
}

function inIpv4Range(address, network, prefix) {
  const shift = 32 - prefix;
  return Math.floor(ipv4Number(address) / (2 ** shift)) === Math.floor(ipv4Number(network) / (2 ** shift));
}

function isBlockedAddress(address) {
  if (net.isIPv4(address)) {
    return BLOCKED_IPV4.some(([network, prefix]) => inIpv4Range(address, network, prefix));
  }
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    const embedded = normalized.slice(7);
    if (net.isIPv4(embedded)) return isBlockedAddress(embedded);
    return true;
  }
  return !normalized.startsWith('2') && !normalized.startsWith('3')
    || normalized.startsWith('2001:db8:');
}

export function validateUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new Error('A source URL is required and must be at most 2048 characters.');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Only credential-free HTTP or HTTPS URLs are allowed.');
  }
  return parsed;
}

export async function resolveTargetAndBlockPrivateHosts(value) {
  const parsed = validateUrl(value);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const literal = net.isIP(hostname);
  const addresses = literal
    ? [{ address: hostname, family: literal }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('The target URL resolves to a private or blocked network address.');
  }
  return { parsed, resolvedIps: addresses.map(({ address }) => address) };
}

// Free bytes on the filesystem that holds the given directory.
export function getFreeDiskBytes(directoryPath) {
  const stats = fs.statfsSync(directoryPath);
  return stats.bavail * stats.bsize;
}

// Refuse to take on work the disk cannot hold. A conversion needs room for
// the downloaded source and the output at the same time, so a nearly full
// disk has to be reported before a job is accepted, not after it filled the
// disk.
export function assertMinimumFreeSpace(minimumBytes, directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  const availableBytes = getFreeDiskBytes(directoryPath);
  if (availableBytes < minimumBytes) {
    const error = new Error(
      'The server is running low on disk space, so new conversions are paused. Try again later.',
    );
    error.status = 507;
    error.exposeToUser = true;
    throw error;
  }
  return availableBytes;
}

export function ensureFreeDiskSpace(requiredBytes, directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  const availableBytes = getFreeDiskBytes(directoryPath);
  const minimumRequired = Number(requiredBytes || 0) + 512 * 1024 * 1024;
  if (availableBytes < minimumRequired) {
    const error = new Error('Not enough free disk space to download and convert this file.');
    error.status = 507;
    error.exposeToUser = true;
    throw error;
  }
  return availableBytes;
}

export function isValidJobId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

export function isValidStreamId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

export function createJobId() {
  return crypto.randomBytes(16).toString('hex');
}

export function resolveDownloadPath(fileName) {
  if (typeof fileName !== 'string' || !/^[a-f0-9]{32}\.mp4$/.test(fileName)) {
    return null;
  }
  const resolved = path.resolve(config.downloadDir, fileName);
  return path.dirname(resolved) === path.resolve(config.downloadDir) ? resolved : null;
}

export function startSafeProxy() {
  const proxy = http.createServer(async (req, res) => {
    let target;
    try {
      target = validateUrl(req.url);
      const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
      if (![80, 443].includes(port) || (target.protocol === 'https:' && port !== 443)) {
        throw new Error('Only standard HTTP and HTTPS ports are allowed.');
      }
      const { resolvedIps } = await resolveTargetAndBlockPrivateHosts(target.href);
      const address = resolvedIps[0];
      const transport = target.protocol === 'https:' ? await import('node:https') : await import('node:http');
      const upstream = transport.default.request(target.href, {
        method: req.method,
        headers: { ...req.headers, host: target.host, connection: 'close' },
        agent: false,
        lookup: (_hostname, _options, callback) => callback(null, address, net.isIP(address)),
      }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      });
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end('Upstream request failed');
      });
      req.pipe(upstream);
      req.on('aborted', () => upstream.destroy());
    } catch {
      res.writeHead(403, { Connection: 'close' });
      res.end('Target URL is not allowed');
    }
  });

  proxy.on('connect', async (req, client, head) => {
    try {
      const separator = req.url.lastIndexOf(':');
      const hostname = req.url.slice(0, separator).replace(/^\[|\]$/g, '');
      const portText = req.url.slice(separator + 1);
      const port = Number(portText || 443);
      if (![80, 443].includes(port) || !hostname) throw new Error('Invalid CONNECT target.');
      const urlHostname = hostname.includes(':') ? `[${hostname}]` : hostname;
      const parsed = new URL(`https://${urlHostname}/`);
      const { resolvedIps } = await resolveTargetAndBlockPrivateHosts(parsed.href);
      const upstream = net.connect(port, resolvedIps[0]);
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });

  return new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', () => {
      proxy.removeListener('error', reject);
      resolve({
        url: `http://127.0.0.1:${proxy.address().port}`,
        close: () => new Promise((closed) => proxy.close(closed)),
      });
    });
  });
}
