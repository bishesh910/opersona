import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';

interface Persona { cloneId: string; name: string | null; prompt: string; promptHash: string }
type Msg =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; input: unknown; ok?: boolean; preview?: string }
  | { kind: 'approval'; id: string; name: string; input: unknown; resolved?: boolean }
  | { kind: 'error'; id: string; text: string };

const MODELS = [
  { id: '', label: 'Default' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];
const uid = () => Math.random().toString(36).slice(2);

export default function App() {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loadErr, setLoadErr] = useState<{ msg: string; pair: boolean } | null>(null);
  const [pixie, setPixie] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [acceptEdits, setAcceptEdits] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadPersona = useCallback(async () => {
    setLoadErr(null);
    const r = await window.opersona.getPersona();
    if (r.ok) setPersona(r.persona);
    else setLoadErr({ msg: r.error, pair: !!r.needsPairing });
  }, []);
  useEffect(() => { void loadPersona(); }, [loadPersona]);
  useEffect(() => { void window.opersona.getPixie().then(setPixie).catch(() => {}); }, []);
  useEffect(() => { window.opersona.setAcceptEdits(acceptEdits); }, [acceptEdits]);

  // agent event stream → messages
  useEffect(() => {
    return window.opersona.onEvent((raw) => {
      const e = raw as { t: string; [k: string]: unknown };
      setMsgs((prev) => {
        const next = [...prev];
        const lastA = () => { for (let i = next.length - 1; i >= 0; i--) if (next[i].kind === 'assistant' && (next[i] as { streaming: boolean }).streaming) return i; return -1; };
        switch (e.t) {
          case 'text': {
            const i = lastA();
            if (i >= 0) { const a = next[i] as Extract<Msg, { kind: 'assistant' }>; next[i] = { ...a, text: a.text + String(e.text) }; }
            else next.push({ kind: 'assistant', id: uid(), text: String(e.text), streaming: true });
            return next;
          }
          case 'tool': next.push({ kind: 'tool', id: String(e.id), name: String(e.name), input: e.input }); return next;
          case 'tool_result': {
            for (let i = next.length - 1; i >= 0; i--) { const m = next[i]; if (m.kind === 'tool' && m.id === e.id) { next[i] = { ...m, ok: Boolean(e.ok), preview: String(e.preview ?? '') }; break; } }
            return next;
          }
          case 'approval': next.push({ kind: 'approval', id: String(e.id), name: String(e.name), input: e.input }); return next;
          case 'error': { const i = lastA(); if (i >= 0) (next[i] as Extract<Msg, { kind: 'assistant' }>).streaming = false; next.push({ kind: 'error', id: uid(), text: String(e.message) }); return next; }
          case 'result': case 'end': { const i = lastA(); if (i >= 0) next[i] = { ...(next[i] as Extract<Msg, { kind: 'assistant' }>), streaming: false }; return next; }
          default: return prev;
        }
      });
      if (e.t === 'result' || e.t === 'end' || e.t === 'error') setBusy(false);
    });
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [msgs]);

  const ensureStarted = useCallback(async (): Promise<boolean> => {
    if (started) return true;
    if (!persona || !folder) return false;
    const r = await window.opersona.startSession({ cwd: folder, prompt: persona.prompt, model: model || undefined });
    if (!r.ok) { setMsgs((m) => [...m, { kind: 'error', id: uid(), text: r.error }]); return false; }
    setStarted(true);
    return true;
  }, [started, persona, folder, model]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!folder) { setMsgs((m) => [...m, { kind: 'error', id: uid(), text: 'Pick a folder first (top of the sidebar).' }]); return; }
    if (!(await ensureStarted())) return;
    setMsgs((m) => [...m, { kind: 'user', id: uid(), text }]);
    setDraft(''); setBusy(true);
    window.opersona.send(text);
  }, [draft, busy, folder, ensureStarted]);

  const answer = (id: string, ok: boolean) => {
    window.opersona.approve(id, ok);
    setMsgs((m) => m.map((x) => (x.kind === 'approval' && x.id === id ? { ...x, resolved: true } : x)));
  };
  const newSession = () => { window.opersona.stop(); setStarted(false); setBusy(false); setMsgs([]); };

  const first = persona?.name?.split(' ')[0] ?? 'you';

  if (loadErr) return (
    <div style={S.app}><div style={S.drag} /><div style={S.centerAll}><div style={S.card}>
      <p style={S.h}>Can’t load your persona</p><p style={S.muted}>{loadErr.msg}</p>
      <div style={S.rowc}>
        <button style={S.primary} onClick={loadPersona}>Retry</button>
        {loadErr.pair && <button style={S.ghost} onClick={() => window.opersona.openSite('/settings#models')}>Pair this machine ↗</button>}
      </div>
    </div></div></div>
  );

  return (
    <div style={S.app}>
      {/* ── sidebar ── */}
      <aside style={S.side}>
        <div style={S.sideDrag} />
        <button style={S.newBtn} onClick={newSession}><span style={{ fontSize: 15 }}>＋</span> New session</button>
        <div style={S.sideSection}>WORKSPACE</div>
        <button style={S.folderBtn} onClick={async () => { const f = await window.opersona.chooseFolder(); if (f) { setFolder(f); newSession(); } }}>
          <span>📁</span><span style={S.folderTxt}>{folder ? folder.split('/').slice(-1)[0] : 'Choose a folder…'}</span>
        </button>
        {folder && <div style={S.folderPath}>{folder}</div>}
        <div style={{ flex: 1 }} />
        <div style={S.sideFoot}>
          {pixie && <img src={pixie} alt="" style={S.faceSm} />}
          <div style={{ minWidth: 0 }}>
            <div style={S.footName}>{persona?.name ?? 'your persona'}</div>
            <button style={S.footLink} onClick={() => window.opersona.openSite('/me')}>manage on opersona.me ↗</button>
          </div>
        </div>
      </aside>

      {/* ── main ── */}
      <main style={S.main}>
        <div style={S.drag} />
        <div ref={scrollRef} style={S.stream}>
          {msgs.length === 0 ? (
            <div style={S.home}>
              {pixie && <img src={pixie} alt="" style={S.faceLg} />}
              <h1 style={S.homeH}>What’s up next, {first}?</h1>
              <p style={S.muted}>{folder
                ? <>Working in <code style={S.code}>{folder}</code> · runs on your Claude, thinking like {persona?.name ?? 'you'}.</>
                : <>Pick a folder in the sidebar, then describe a task. Claude Code runs locally, thinking like {persona?.name ?? 'you'}.</>}</p>
            </div>
          ) : (
            <div style={S.msgs}>
              {msgs.map((m) => <MsgRow key={m.id} m={m} onAnswer={answer} />)}
              {busy && !msgs.some((m) => m.kind === 'assistant' && m.streaming) && <div style={S.thinking}><Dot /><Dot /><Dot /></div>}
            </div>
          )}
        </div>

        {/* composer */}
        <div style={S.composerWrap}>
          <div style={S.composer}>
            <textarea style={S.textarea} rows={1} value={draft} placeholder="Describe a task or ask a question"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
            <button style={{ ...S.sendBtn, opacity: draft.trim() && !busy ? 1 : 0.4 }} disabled={!draft.trim() || busy} onClick={() => void submit()}>↵</button>
          </div>
          <div style={S.composerBar}>
            <button style={{ ...S.toggle, ...(acceptEdits ? S.toggleOn : {}) }} onClick={() => setAcceptEdits((v) => !v)}>
              {acceptEdits ? '✓ ' : ''}Accept edits
            </button>
            <select style={S.modelSel} value={model} onChange={(e) => { setModel(e.target.value); newSession(); }}>
              {MODELS.map((mm) => <option key={mm.id} value={mm.id}>{mm.label}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            {busy && <button style={S.stopMini} onClick={() => { window.opersona.stop(); setBusy(false); setStarted(false); }}>■ stop</button>}
            <button style={S.siteMini} onClick={() => window.opersona.openSite('')}>opersona.me ↗</button>
          </div>
        </div>
      </main>
    </div>
  );
}

function MsgRow({ m, onAnswer }: { m: Msg; onAnswer: (id: string, ok: boolean) => void }) {
  if (m.kind === 'user') return <div style={S.userRow}><div style={S.userBub}>{m.text}</div></div>;
  if (m.kind === 'assistant') return <div style={S.md}><Markdown>{m.text || '…'}</Markdown></div>;
  if (m.kind === 'error') return <div style={S.errRow}>{m.text}</div>;
  if (m.kind === 'tool') return (
    <div style={S.tool}>
      <div style={S.toolHead}><span style={S.toolName}>{m.name}</span>{m.ok === false && <span style={S.toolErr}>failed</span>}</div>
      <div style={S.toolInput}>{summarize(m.input)}</div>
      {m.preview && <pre style={S.toolPrev}>{m.preview.slice(0, 600)}</pre>}
    </div>
  );
  // approval
  return (
    <div style={S.approve}>
      <div style={S.toolHead}><span style={S.toolName}>Allow {m.name}?</span></div>
      <div style={S.toolInput}>{summarize(m.input)}</div>
      {!m.resolved ? (
        <div style={S.rowc}>
          <button style={S.primary} onClick={() => onAnswer(m.id, true)}>Allow</button>
          <button style={S.ghost} onClick={() => onAnswer(m.id, false)}>Deny</button>
        </div>
      ) : <div style={S.muted}>answered</div>}
    </div>
  );
}

function summarize(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const s = (o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.query) as string | undefined;
    if (s) return String(s);
  }
  try { return JSON.stringify(input).slice(0, 200); } catch { return ''; }
}
function Dot() { return <span style={S.dot} />; }

const AMBER = '#f59e0b';
const S: Record<string, React.CSSProperties> = {
  app: { display: 'flex', height: '100vh', background: '#0b0b0f', color: '#e6e6ea', fontFamily: '-apple-system, system-ui, sans-serif', overflow: 'hidden' },
  drag: { position: 'absolute', top: 0, left: 0, right: 0, height: 30, WebkitAppRegion: 'drag' } as React.CSSProperties,
  centerAll: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  side: { position: 'relative', width: 240, flexShrink: 0, background: '#0e0e14', borderRight: '1px solid #1c1c24', display: 'flex', flexDirection: 'column', padding: 12, paddingTop: 40 },
  sideDrag: { position: 'absolute', top: 0, left: 0, right: 0, height: 30, WebkitAppRegion: 'drag' } as React.CSSProperties,
  newBtn: { display: 'flex', alignItems: 'center', gap: 8, background: '#16161e', color: '#e6e6ea', border: '1px solid #26262f', borderRadius: 9, padding: '9px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left' },
  sideSection: { fontSize: 10, letterSpacing: '0.12em', color: '#5a5a66', margin: '18px 4px 6px', fontFamily: 'ui-monospace, monospace' },
  folderBtn: { display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', color: '#c8c8d0', border: '1px solid #22222b', borderRadius: 8, padding: '8px 10px', fontSize: 13, cursor: 'pointer', textAlign: 'left' },
  folderTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  folderPath: { fontSize: 10, color: '#5a5a66', margin: '4px 6px 0', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace' },
  sideFoot: { display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #1c1c24', paddingTop: 10 },
  faceSm: { width: 28, height: 28, imageRendering: 'pixelated', borderRadius: 7 } as React.CSSProperties,
  footName: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  footLink: { background: 'none', border: 'none', color: '#6b6b76', fontSize: 11, cursor: 'pointer', padding: 0 },
  main: { position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  stream: { flex: 1, overflow: 'auto', padding: '44px 0 8px' },
  home: { maxWidth: 640, margin: '8vh auto 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, padding: '0 28px' },
  faceLg: { width: 56, height: 56, imageRendering: 'pixelated', borderRadius: 13, background: '#12121a' } as React.CSSProperties,
  homeH: { fontSize: 26, fontWeight: 600, margin: 0 },
  msgs: { maxWidth: 720, margin: '0 auto', padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 16 },
  userRow: { display: 'flex', justifyContent: 'flex-end' },
  userBub: { background: '#1e1e28', borderRadius: 14, padding: '9px 14px', fontSize: 14, maxWidth: '80%', whiteSpace: 'pre-wrap' },
  md: { fontSize: 14, lineHeight: 1.6, color: '#e6e6ea' },
  errRow: { color: '#ff8787', fontSize: 13, borderLeft: '2px solid #ff8787', paddingLeft: 12 },
  tool: { border: '1px solid #22222b', borderRadius: 10, padding: 10, background: '#0f0f16' },
  toolHead: { display: 'flex', alignItems: 'center', gap: 8 },
  toolName: { fontFamily: 'ui-monospace, monospace', fontSize: 12, color: AMBER },
  toolErr: { fontSize: 10, color: '#ff8787', border: '1px solid #4a2424', borderRadius: 4, padding: '0 5px' },
  toolInput: { fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#a8a8b2', marginTop: 4, wordBreak: 'break-all' },
  toolPrev: { marginTop: 6, fontSize: 11, color: '#8a8a95', background: '#0b0b11', borderRadius: 6, padding: 8, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap' },
  approve: { border: `1px solid ${AMBER}`, borderRadius: 10, padding: 12, background: 'rgba(245,158,11,0.06)', display: 'flex', flexDirection: 'column', gap: 8 },
  thinking: { display: 'flex', gap: 5, padding: '4px 2px' },
  dot: { width: 6, height: 6, borderRadius: 3, background: AMBER, opacity: 0.7, animation: 'none' },
  composerWrap: { padding: '10px 28px 18px', maxWidth: 776, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
  composer: { display: 'flex', alignItems: 'flex-end', gap: 8, background: '#14141c', border: '1px solid #26262f', borderRadius: 14, padding: '8px 8px 8px 14px' },
  textarea: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e6e6ea', fontSize: 14, resize: 'none', fontFamily: 'inherit', maxHeight: 160, lineHeight: 1.5, paddingTop: 4 },
  sendBtn: { width: 32, height: 32, borderRadius: 9, border: 'none', background: AMBER, color: '#1a1206', fontSize: 15, cursor: 'pointer', flexShrink: 0 },
  composerBar: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 },
  toggle: { background: '#15151c', color: '#8a8a95', border: '1px solid #26262f', borderRadius: 7, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  toggleOn: { borderColor: 'rgba(245,158,11,0.5)', color: AMBER, background: 'rgba(245,158,11,0.08)' },
  modelSel: { background: '#15151c', color: '#c8c8d0', border: '1px solid #26262f', borderRadius: 7, padding: '4px 8px', fontSize: 12 },
  stopMini: { background: 'rgba(255,107,107,0.12)', color: '#ff8787', border: '1px solid rgba(255,107,107,0.35)', borderRadius: 7, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  siteMini: { background: 'none', border: 'none', color: '#5a5a66', fontSize: 12, cursor: 'pointer' },
  card: { maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center', alignItems: 'center' },
  h: { fontSize: 17, fontWeight: 600, margin: 0 },
  muted: { fontSize: 13, color: '#8a8a95', lineHeight: 1.55, margin: 0 },
  rowc: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  primary: { background: AMBER, color: '#1a1206', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ghost: { background: 'transparent', color: '#b8b8c0', border: '1px solid #2a2a34', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer' },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#15151c', borderRadius: 5, padding: '1px 6px' },
};
