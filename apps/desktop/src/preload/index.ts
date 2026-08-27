/**
 * The only surface the renderer can touch. Everything is a typed wrapper over an
 * IPC channel — no Node, no remote code, no shell in the renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface Persona { cloneId: string; name: string | null; prompt: string; promptHash: string }
type PersonaResult = { ok: true; persona: Persona } | { ok: false; error: string; needsPairing?: boolean };
type SpawnResult = { ok: true; pid: number } | { ok: false; error: string };

const api = {
  getPersona: (): Promise<PersonaResult> => ipcRenderer.invoke('persona:get'),
  siteUrl: (): Promise<string> => ipcRenderer.invoke('site:url'),
  openSite: (path = ''): Promise<void> => ipcRenderer.invoke('site:open', path),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseFolder'),

  startClaude: (opts: { id: string; cwd: string; prompt: string; model?: string; cols?: number; rows?: number }): Promise<SpawnResult> =>
    ipcRenderer.invoke('claude:start', opts),
  write: (id: string, data: string): void => ipcRenderer.send('pty:write', id, data),
  resize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty:resize', id, cols, rows),
  redraw: (id: string): void => ipcRenderer.send('pty:redraw', id),
  kill: (id: string): void => ipcRenderer.send('pty:kill', id),

  onData: (id: string, cb: (data: string) => void): (() => void) => {
    const ch = `pty:data:${id}`;
    const h = (_e: unknown, data: string): void => cb(data);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
  onExit: (id: string, cb: (code: number) => void): (() => void) => {
    const ch = `pty:exit:${id}`;
    const h = (_e: unknown, code: number): void => cb(code);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
};

contextBridge.exposeInMainWorld('opersona', api);
export type OpersonaApi = typeof api;
