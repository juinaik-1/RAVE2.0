import crypto from 'node:crypto';
import { config } from './config.js';

const ALGORITHM = 'aes-256-gcm';

export function encryptToken(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, config.tokenEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptToken(value) {
  const [ivText, tagText, encryptedText] = String(value).split('.');
  if (!ivText || !tagText || !encryptedText) {
    throw new Error('Stored Drive credentials are invalid. Reconnect Google Drive.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, config.tokenEncryptionKey, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
