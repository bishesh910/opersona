/** The only surface the renderer can touch — typed IPC wrappers, no Node. */
import { contextBridge, ipcRenderer } from 'electron';

export interface Persona { cloneId: string; name: string | null; prompt: string; promptHash: string }
type PersonaResult = { ok: true; persona: Persona } | { ok: false; error: string; needsPairing?: boolean };
type StartResult = { ok: true } | { ok: false; error: string };

const api = {
  getPersona: (): Promise<PersonaResult> => ipcRenderer.invoke('persona:get'),
  siteUrl: (): Promise<string> => ipcRenderer.invoke('site:url'),
  getPixie: (): Promise<string | null> => ipcRenderer.invoke('pixie:get'),
  openSite: (path = ''): Promise<void> => ipcRenderer.invoke('site:open', path),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  onUpdate: (cb: (info: { version: string }) => void): (() => void) => {
    const h = (_e: unknown, info: { version: string }): void => cb(info);
    ipcRenderer.on('update:available', h);
    return () => ipcRenderer.removeListener('update:available', h);
  },
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseFolder'),

  startSession: (opts: { cwd: string; prompt: string; model?: string }): Promise<StartResult> => ipcRenderer.invoke('agent:start', opts),
  send: (text: string): void => ipcRenderer.send('agent:send', text),
  approve: (id: string, ok: boolean): void => ipcRenderer.send('agent:approve', id, ok),
  stop: (): void => ipcRenderer.send('agent:stop'),
  setAcceptEdits: (v: boolean): void => ipcRenderer.send('agent:setAcceptEdits', v),

  onEvent: (cb: (e: unknown) => void): (() => void) => {
    const h = (_e: unknown, ev: unknown): void => cb(ev);
    ipcRenderer.on('agent:event', h);
    return () => ipcRenderer.removeListener('agent:event', h);
  },
};

contextBridge.exposeInMainWorld('opersona', api);
export type OpersonaApi = typeof api;
