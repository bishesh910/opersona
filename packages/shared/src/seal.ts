/**
 * Sealed conversations — the crypto core (Node side; the browser has a WebCrypto
 * twin with the identical wire format).
 *
 * AES-256-GCM with a 32-byte workspace key that is generated in the user's
 * browser and NEVER sent to the server. It reaches the bridge through the
 * opersona:// deep link (an OS-local hop). The server stores only a key
 * fingerprint and ciphertext.
 *
 * Wire format:  enc1:<base64 iv(12)>:<base64 ciphertext||gcm-tag>
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const SEAL_PREFIX = 'enc1:';

export const isSealed = (s: string | null | undefined): boolean => !!s && s.startsWith(SEAL_PREFIX);

/** Short server-storable identifier of a key — never the key. */
export function sealKeyFingerprint(keyB64: string): string {
  return createHash('sha256').update('opersona-seal:' + keyB64).digest('hex').slice(0, 16);
}

export function sealEncrypt(keyB64: string, plaintext: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('seal key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final(), cipher.getAuthTag()]);
  return SEAL_PREFIX + iv.toString('base64') + ':' + ct.toString('base64');
}

export function sealDecrypt(keyB64: string, sealed: string): string {
  if (!sealed.startsWith(SEAL_PREFIX)) throw new Error('not sealed content');
  const [ivB64, ctB64] = sealed.slice(SEAL_PREFIX.length).split(':');
  if (!ivB64 || !ctB64) throw new Error('malformed sealed content');
  const key = Buffer.from(keyB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const blob = Buffer.from(ctB64, 'base64');
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export const generateSealKey = (): string => randomBytes(32).toString('base64');
