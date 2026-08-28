'use client';
/**
 * Browser twin of the seal crypto (WebCrypto AES-256-GCM, identical wire format
 * to packages/shared/src/seal.ts). The key is generated HERE, lives in
 * localStorage, and reaches the bridge only by the user pasting it into
 * `npx opersona --seal-key …` on their machine —
 * an OS-local hop the server never sees.
 */
export const SEAL_PREFIX = 'enc1:';
export const isSealed = (s: string | null | undefined): boolean => !!s && s.startsWith(SEAL_PREFIX);

const b64 = (buf: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function generateSealKeyB64(): string {
  const k = new Uint8Array(32);
  crypto.getRandomValues(k);
  return b64(k);
}

export async function sealKeyFingerprint(keyB64: string): Promise<string> {
  const data = new TextEncoder().encode('opersona-seal:' + keyB64);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64(keyB64) as unknown as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function sealEncrypt(keyB64: string, plaintext: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importKey(keyB64);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return SEAL_PREFIX + b64(iv) + ':' + b64(ct); // subtle appends the GCM tag — same layout as node
}

export async function sealDecrypt(keyB64: string, sealed: string): Promise<string> {
  if (!sealed.startsWith(SEAL_PREFIX)) throw new Error('not sealed');
  const [ivB64, ctB64] = sealed.slice(SEAL_PREFIX.length).split(':');
  const key = await importKey(keyB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64!) as unknown as ArrayBuffer }, key, unb64(ctB64!) as unknown as ArrayBuffer);
  return new TextDecoder().decode(pt);
}

// ── local key store, keyed by server-side fingerprint ───────────────────────
const LS = (fp: string) => `opersona.seal.${fp}`;
export function loadSealKey(fp: string): string | null {
  try { return localStorage.getItem(LS(fp)); } catch { return null; }
}
export function storeSealKey(fp: string, keyB64: string): void {
  try { localStorage.setItem(LS(fp), keyB64); } catch { /* private mode */ }
}
