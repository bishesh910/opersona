/**
 * xterm wiring — the terminal that shows the live Claude Code session. Carries
 * the details the reference proved load-bearing: Unicode11 (emoji width must
 * match Claude's assumption), allowProposedApi, resize only when cols/rows
 * actually change (each resize repaints the whole TUI into scrollback), and a
 * redraw() after open() to catch output that predated the subscription.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

const theme = {
  background: '#0b0b0f', foreground: '#e6e6ea', cursor: '#e6e6ea',
  selectionBackground: '#33343f',
  black: '#1b1b22', red: '#ff6b6b', green: '#4ade80', yellow: '#fbbf24',
  blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e6e6ea',
  brightBlack: '#6b6b76', brightRed: '#ff8787', brightGreen: '#86efac', brightYellow: '#fde047',
  brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};

export interface TermHandle {
  term: Terminal;
  dispose: () => void;
  fit: () => { cols: number; rows: number };
}

export function mountTerminal(host: HTMLElement, id: string): TermHandle {
  const api = window.opersona;
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.0,
    scrollback: 100_000,
    minimumContrastRatio: 4.5,
    allowProposedApi: true,
    cursorBlink: true,
    theme,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const uni = new Unicode11Addon();
  term.loadAddon(uni);
  term.unicode.activeVersion = '11';

  term.open(host);

  const offData = api.onData(id, (data) => term.write(data));
  const offExit = api.onExit(id, (code) => term.write(`\r\n\x1b[90m— session ended (${code}) —\x1b[0m\r\n`));
  term.onData((d) => api.write(id, d));

  let lastCols = 0, lastRows = 0;
  const fit = () => {
    try { fitAddon.fit(); } catch { /* not laid out yet */ }
    if (term.cols !== lastCols || term.rows !== lastRows) {
      lastCols = term.cols; lastRows = term.rows;
      api.resize(id, term.cols, term.rows);
    }
    return { cols: term.cols, rows: term.rows };
  };

  // double-rAF so the host has real dimensions, then a redraw to catch early output
  requestAnimationFrame(() => requestAnimationFrame(() => { fit(); api.redraw(id); }));

  const ro = new ResizeObserver(() => fit());
  ro.observe(host);

  const dispose = () => { ro.disconnect(); offData(); offExit(); term.dispose(); };
  return { term, dispose, fit };
}
