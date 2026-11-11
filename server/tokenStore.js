import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const storePath = path.join(config.dataDir, 'drive-tokens.json');

function readStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('Unable to read the encrypted Drive token store.');
  }
}

function writeStore(store) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store), { mode: 0o600 });
  fs.renameSync(temporaryPath, storePath);
}

export function getStoredDriveToken(userId) {
  return readStore()[userId] || null;
}

export function saveStoredDriveToken(userId, email, encryptedRefreshToken, scopes) {
  const store = readStore();
  store[userId] = {
    email,
    encryptedRefreshToken,
    scopes: [...new Set(scopes)],
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
}

export function deleteStoredDriveToken(userId) {
  const store = readStore();
  delete store[userId];
  writeStore(store);
}
