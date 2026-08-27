/**
 * opersona desktop — the app that IS Claude Code, thinking like you.
 * Runs the Agent SDK locally (your subscription) in a folder you pick, with your
 * persona as the system prompt, and streams the turn to a native chat GUI.
 */
import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AgentSession } from './agent.js';
import { fetchPersona, siteUrl, fetchPixiePng } from './persona.js';
import { ensureClaudeTrust } from './claudeConfig.js';
import { startUpdateChecks } from './updater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.ELECTRON_RENDERER_URL;
let win: BrowserWindow | null = null;
let session: AgentSession | null = null;
let acceptEdits = false;
const pendingApprovals = new Map<string, (ok: boolean) => void>();

function send(e: unknown): void { if (win && !win.isDestroyed()) win.webContents.send('agent:event', e); }

function createWindow(): void {
  win = new BrowserWindow({
    width: 1160, height: 780, minWidth: 820, minHeight: 520, show: false,
    titleBarStyle: 'hiddenInset', backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => { win?.show(); void applyPixieIcon(); });
  startUpdateChecks((info) => win?.webContents.send('update:available', info));
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

async function applyPixieIcon(): Promise<void> {
  try {
    const png = await fetchPixiePng();
    if (!png) return;
    const img = nativeImage.createFromBuffer(png);
    if (img.isEmpty()) return;
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(img);
    win?.setIcon(img);
  } catch { /* bundled icon stands */ }
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('persona:get', () => fetchPersona());
ipcMain.handle('site:url', () => siteUrl());
ipcMain.handle('site:open', (_e, path: string) => shell.openExternal(siteUrl() + (typeof path === 'string' ? path : '')));
ipcMain.handle('update:download', () => shell.openExternal(siteUrl() + '/download'));
ipcMain.handle('pixie:get', async () => { const p = await fetchPixiePng(); return p ? `data:image/png;base64,${p.toString('base64')}` : null; });
ipcMain.handle('dialog:chooseFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

ipcMain.on('agent:setAcceptEdits', (_e, v: boolean) => { acceptEdits = !!v; });

ipcMain.handle('agent:start', (_e, opts: { cwd: string; prompt: string; model?: string }) => {
  if (!opts?.cwd || typeof opts.prompt !== 'string') return { ok: false, error: 'bad options' };
  try {
    ensureClaudeTrust(opts.cwd);
    session?.stop();
    session = new AgentSession({
      cwd: opts.cwd, systemPrompt: opts.prompt, model: opts.model,
      emit: (ev) => send(ev),
      acceptEdits: () => acceptEdits,
      requestApproval: (name, input) => new Promise<boolean>((resolve) => {
        const id = randomUUID();
        pendingApprovals.set(id, resolve);
        send({ t: 'approval', id, name, input });
      }),
    });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
});
ipcMain.on('agent:send', (_e, text: string) => { if (session && typeof text === 'string' && text.trim()) session.send(text); });
ipcMain.on('agent:approve', (_e, id: string, ok: boolean) => { const r = pendingApprovals.get(id); if (r) { pendingApprovals.delete(id); r(!!ok); } });
ipcMain.on('agent:stop', () => { session?.stop(); session = null; for (const r of pendingApprovals.values()) r(false); pendingApprovals.clear(); });

// ── lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { session?.stop(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => session?.stop());
