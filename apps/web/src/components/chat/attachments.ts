/** Client-side attachment prep for the chat composer: validation, image downscaling, base64 encoding. */

export const MAX_FILES = 8;
export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 1600;

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|yaml|yml|xml|html|htm|css|py|js|jsx|ts|tsx|sh|bash|zsh|sql|toml|ini|conf|cfg|env|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|diff|patch)$/i;
export const ACCEPT = 'image/*,.pdf,.zip,.txt,.md,.markdown,.json,.csv,.tsv,.log,.yaml,.yml,.xml,.html,.htm,.css,.py,.js,.jsx,.ts,.tsx,.sh,.bash,.sql,.toml,.ini,.conf,.cfg,.rb,.go,.rs,.java,.kt,.c,.h,.cpp,.hpp,.cs,.php,.swift,.diff,.patch';

export interface PendingFile {
  id: string;
  file: File;
  /** Object URL for image thumbnails (revoked on removal). */
  previewUrl?: string;
}

export interface OutAttachment { name: string; mime: string; dataBase64: string }

export function isImage(f: File) { return f.type.startsWith('image/'); }

/** Accept images, PDFs, zips and common text/code files. Returns a reason string when rejected. */
export function rejectReason(f: File): string | null {
  if (f.size > MAX_BYTES) return `${f.name}: larger than 10 MB`;
  if (isImage(f) || f.type === 'application/pdf') return null;
  if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) return null;
  if (f.type.startsWith('text/') || TEXT_EXT.test(f.name)) return null;
  return `${f.name}: unsupported type`;
}

export function toPending(files: File[]): PendingFile[] {
  return files.map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, previewUrl: isImage(file) ? URL.createObjectURL(file) : undefined }));
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('bad image')); img.src = url; });
}

/** Images: downscale to ≤1600px and JPEG q0.85, except small PNGs (<1 MB) which are kept as-is. Others: read verbatim. */
export async function encodeAttachment(p: PendingFile): Promise<OutAttachment> {
  const f = p.file;
  if (isImage(f) && !(f.type === 'image/png' && f.size < 1024 * 1024) && f.type !== 'image/gif') {
    try {
      const img = await loadImage(p.previewUrl ?? URL.createObjectURL(f));
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // JPEG has no alpha
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const name = f.name.replace(/\.[^.]+$/, '') + '.jpg';
        return { name, mime: 'image/jpeg', dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
      }
    } catch { /* fall through to raw */ }
  }
  const mime = f.type || (TEXT_EXT.test(f.name) ? 'text/plain' : 'application/octet-stream');
  return { name: f.name, mime, dataBase64: bufToBase64(await f.arrayBuffer()) };
}

export function fmtSize(n: number) { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; }
