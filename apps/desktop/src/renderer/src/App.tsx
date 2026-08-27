import { useCallback, useEffect, useRef, useState } from 'react';
import { mountTerminal, type TermHandle } from './terminal';

interface Persona { cloneId: string; name: string | null; prompt: string; promptHash: string }
type Phase = 'loading' | 'error' | 'ready' | 'running';
type Tab = 'dispatch' | 'persona';

const MODELS = [
  { id: '', label: 'Default' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'dispatch', icon: '>_', label: 'dispatch' },
  { key: 'persona', icon: '◇', label: 'persona' },
];

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [persona, setPersona] = useState<Persona | null>(null);
  const [error, setError] = useState('');
  const [needsPairing, setNeedsPairing] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [startErr, setStartErr] = useState<string | null>(null);
  const [pixie, setPixie] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('dispatch');
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TermHandle | null>(null);
  const sidRef = useRef('');

  const loadPersona = useCallback(async () => {
    setPhase('loading'); setError(''); setNeedsPairing(false);
    const r = await window.opersona.getPersona();
    if (r.ok) { setPersona(r.persona); setPhase('ready'); }
    else { setError(r.error); setNeedsPairing(!!r.needsPairing); setPhase('error'); }
  }, []);
  useEffect(() => { void loadPersona(); }, [loadPersona]);
  useEffect(() => { void window.opersona.getPixie().then(setPixie).catch(() => {}); }, []);

  const start = useCallback(async () => {
    if (!persona || !folder || phase === 'running') return;
    setStartErr(null); setTab('dispatch');
    const id = 'sess-' + Math.random().toString(36).slice(2);
    sidRef.current = id;
    setPhase('running');
    requestAnimationFrame(() => {
      if (!hostRef.current) return;
      const h = mountTerminal(hostRef.current, id);
      handleRef.current = h;
      const { cols, rows } = h.fit();
      void window.opersona.startClaude({ id, cwd: folder, prompt: persona.prompt, model: model || undefined, cols, rows })
        .then((res) => { if (!res.ok) setStartErr(res.error); });
    });
  }, [persona, folder, model, phase]);

  const stop = useCallback(() => {
    if (sidRef.current) window.opersona.kill(sidRef.current);
    handleRef.current?.dispose(); handleRef.current = null;
    setPhase('ready');
  }, []);
  useEffect(() => () => { handleRef.current?.dispose(); }, []);

  const first = persona?.name?.split(' ')[0] ?? 'your persona';
  const running = phase === 'running';

  return (
    <div style={S.app}>
      {/* drag strip */}
      <div style={S.titlebar}>
        <span style={{ flex: 1 }} />
        <button style={S.ghost} onClick={() => window.opersona.openSite('')}>opersona.me ↗</button>
      </div>

      {phase === 'loading' && <div style={S.center}><p style={S.muted}>Loading your persona…</p></div>}

      {phase === 'error' && (
        <div style={S.center}>
          <div style={S.card}>
            <p style={S.h}>Can’t load your persona</p>
            <p style={S.muted}>{error}</p>
            <div style={S.rowc}>
              <button style={S.primary} onClick={loadPersona}>Retry</button>
              {needsPairing && <button style={S.ghost} onClick={() => window.opersona.openSite('/settings#models')}>Pair this machine ↗</button>}
            </div>
          </div>
        </div>
      )}

      {persona && phase !== 'loading' && phase !== 'error' && (
        <div style={S.body}>
          {/* Command-Center-style header: portrait + "runs the floor" */}
          <div style={S.header}>
            {pixie
              ? <img src={pixie} alt="" style={S.portrait} />
              : <div style={{ ...S.portrait, background: '#15151c' }} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={S.kicker}>OPERSONA <span style={S.beta}>on this machine</span></p>
              <div style={S.nameRow}>
                <span style={S.name}>{persona.name ?? 'Your persona'}</span>
                <span style={S.sub}>{first} runs this floor</span>
              </div>
            </div>
            {running
              ? <button style={S.stopBtn} onClick={stop}>■ stop</button>
              : <button style={{ ...S.primary, opacity: folder ? 1 : 0.5 }} disabled={!folder} onClick={start}>Start ▶</button>}
          </div>

          {/* workspace row */}
          <div style={S.wsRow}>
            <button style={S.chip} disabled={running} onClick={async () => setFolder(await window.opersona.chooseFolder())}>
              {folder ? '📁 ' + shorten(folder) : 'Choose a folder…'}
            </button>
            <select style={S.select} disabled={running} value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <span style={S.dim}>{running ? '● live · your Claude' : `${persona.promptHash}`}</span>
          </div>

          {/* tab grid, Command-Center style */}
          <div style={S.tabs} role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                style={{ ...S.tab, ...(tab === t.key ? S.tabOn : {}) }}>
                <span style={{ opacity: 0.7 }}>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {/* content */}
          <div style={S.content}>
            {/* terminal always mounted while running; hidden when on persona tab */}
            <div style={{ display: tab === 'dispatch' ? 'block' : 'none', height: '100%' }}>
              {!running && (
                <div style={S.centerFill}>
                  <div style={S.card}>
                    <p style={S.h}>Claude Code, thinking like {persona.name ?? 'you'}</p>
                    <p style={S.muted}>Pick a folder and hit Start. The real Claude Code runs on your
                      machine, on your own subscription, with your persona as its system prompt. Every command asks you in the terminal.</p>
                  </div>
                </div>
              )}
              {startErr && <p style={{ ...S.err, padding: '8px 12px' }}>{startErr}</p>}
              <div ref={hostRef} style={{ ...S.term, display: running ? 'block' : 'none' }} />
            </div>

            {tab === 'persona' && (
              <div style={S.personaPane}>
                <div style={S.pRow}><span style={S.pKey}>Persona</span><span style={S.pVal}>{persona.name ?? '—'}</span></div>
                <div style={S.pRow}><span style={S.pKey}>Fingerprint</span><span style={S.pVal}>{persona.promptHash}</span></div>
                <div style={S.pRow}><span style={S.pKey}>Loaded</span><span style={S.pVal}>{persona.prompt.length.toLocaleString()} chars of how you think</span></div>
                <p style={S.muted}>This is the system prompt every session runs with — built on opersona.me from your
                  patterns, facts and playbooks. Edit what it knows there.</p>
                <div style={S.rowc}>
                  <button style={S.ghost} onClick={() => window.opersona.openSite('/me')}>Manage persona ↗</button>
                  <button style={S.ghost} onClick={loadPersona}>Reload</button>
                </div>
                <pre style={S.promptBox}>{persona.prompt}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function shorten(p: string): string {
  const parts = p.split('/');
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
}

const AMBER = '#f59e0b';
const S: Record<string, React.CSSProperties> = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b0f', color: '#e6e6ea', fontFamily: '-apple-system, system-ui, sans-serif', overflow: 'hidden' },
  titlebar: { display: 'flex', alignItems: 'center', height: 30, padding: '0 10px 0 84px', WebkitAppRegion: 'drag' } as React.CSSProperties,
  ghost: { WebkitAppRegion: 'no-drag', background: 'transparent', color: '#8a8a95', border: '1px solid #2a2a34', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' } as React.CSSProperties,
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  centerFill: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center', alignItems: 'center' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '4px 16px 16px', gap: 12 },
  header: { display: 'flex', alignItems: 'center', gap: 14 },
  portrait: { width: 56, height: 56, imageRendering: 'pixelated', borderRadius: 12, border: '1px solid #2a2a34' } as React.CSSProperties,
  kicker: { margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', color: AMBER },
  beta: { marginLeft: 8, background: 'rgba(245,158,11,0.12)', color: AMBER, borderRadius: 4, padding: '1px 6px', fontSize: 9, letterSpacing: '0.04em' },
  nameRow: { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 },
  name: { fontSize: 20, fontWeight: 600 },
  sub: { fontSize: 13, color: '#8a8a95' },
  stopBtn: { background: 'rgba(255,107,107,0.12)', color: '#ff8787', border: '1px solid rgba(255,107,107,0.4)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  primary: { background: AMBER, color: '#1a1206', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  wsRow: { display: 'flex', alignItems: 'center', gap: 10 },
  chip: { background: '#15151c', color: '#e6e6ea', border: '1px solid #2a2a34', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  select: { background: '#15151c', color: '#e6e6ea', border: '1px solid #2a2a34', borderRadius: 8, padding: '6px 10px', fontSize: 12 },
  dim: { fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#6b6b76' },
  tabs: { display: 'flex', gap: 6 },
  tab: { display: 'flex', alignItems: 'center', gap: 6, background: '#15151c', color: '#8a8a95', border: '1px solid #26262f', borderRadius: 8, padding: '6px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 12, cursor: 'pointer' },
  tabOn: { borderColor: AMBER, background: 'rgba(245,158,11,0.1)', color: '#f3e6c8', fontWeight: 600 },
  content: { flex: 1, minHeight: 0, border: '1px solid #26262f', borderRadius: 12, overflow: 'hidden', background: '#0b0b0f' },
  term: { width: '100%', height: '100%', padding: 8, boxSizing: 'border-box' },
  h: { fontSize: 17, fontWeight: 600, margin: 0 },
  muted: { fontSize: 13, color: '#8a8a95', lineHeight: 1.5, margin: 0 },
  rowc: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  err: { fontSize: 12, color: '#ff8787', margin: 0 },
  personaPane: { height: '100%', overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 },
  pRow: { display: 'flex', gap: 12, fontSize: 13 },
  pKey: { width: 110, color: '#6b6b76', fontFamily: 'ui-monospace, monospace', fontSize: 11 },
  pVal: { color: '#e6e6ea' },
  promptBox: { marginTop: 6, background: '#101017', border: '1px solid #22222b', borderRadius: 8, padding: 12, fontSize: 11, lineHeight: 1.5, color: '#a8a8b2', whiteSpace: 'pre-wrap', overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
};
