/**
 * opersona desktop — the app that IS Claude Code, thinking like you.
 *
 * It fetches your persona from opersona.me (built there, on the web) and runs
 * the real `claude` CLI locally in a folder you pick, with your persona as the
 * appended system prompt. Full tools, your own subscription, nothing executes
 * on our servers — the site never sits in the loop.
 */
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PtyManager } from './pty.js';
import { fetchPersona, siteUrl } from './persona.js';
import { ensureClaudeTrust } from './claudeConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.ELECTRON_RENDERER_URL;
const ptys = new PtyManager();
let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,        // preload needs Node to require the bridge (no remote code runs)
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('persona:get', () => fetchPersona());
ipcMain.handle('site:url', () => siteUrl());
ipcMain.handle('site:open', (_e, path: string) => shell.openExternal(siteUrl() + (typeof path === 'string' ? path : '')));

ipcMain.handle('dialog:chooseFolder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

/** Build the `claude` argv and spawn it with the persona as the system prompt. */
ipcMain.handle('claude:start', (e, opts: { id: string; cwd: string; prompt: string; model?: string; cols?: number; rows?: number }) => {
  if (!opts?.id || !opts?.cwd || typeof opts.prompt !== 'string') return { ok: false, error: 'bad start options' };
  ensureClaudeTrust(opts.cwd);
  const args: string[] = ['--append-system-prompt', opts.prompt, '--add-dir', opts.cwd];
  if (opts.model) args.push('--model', opts.model);
  const wc = BrowserWindow.fromWebContents(e.sender)?.webContents ?? e.sender;
  return ptys.spawn({ id: opts.id, args, cwd: opts.cwd, cols: opts.cols, rows: opts.rows }, wc);
});
ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data));
ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows));
ipcMain.on('pty:redraw', (_e, id: string) => ptys.redraw(id));
ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id));

// ── lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { ptys.killAll(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => ptys.killAll());
