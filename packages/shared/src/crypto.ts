/**
 * AES-256-GCM column encryption for org secrets (e.g. BYO Anthropic API keys).
 * Key: `SECRETS_KEK` env, 32 bytes base64. Wire format: `v1:<iv_b64>:<tag_b64>:<ct_b64>`.
 * Node `crypto` only — usable from both the web app and the engine.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function kek(): Buffer {
  const raw = process.env.SECRETS_KEK;
  if (!raw) throw new Error('SECRETS_KEK is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SECRETS_KEK must decode to 32 bytes');
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const [v, ivB, tagB, ctB] = enc.split(':');
  if (v !== 'v1' || !ivB || !tagB || !ctB) throw new Error('bad secret format');
  const decipher = createDecipheriv('aes-256-gcm', kek(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
