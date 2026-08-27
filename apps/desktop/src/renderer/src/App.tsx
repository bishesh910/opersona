import { useCallback, useEffect, useRef, useState } from 'react';
import { mountTerminal, type TermHandle } from './terminal';

interface Persona { cloneId: string; name: string | null; prompt: string; promptHash: string }
type Phase = 'loading' | 'error' | 'ready' | 'running';

const MODELS = [
  { id: '', label: 'Default' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [persona, setPersona] = useState<Persona | null>(null);
  const [error, setError] = useState<string>('');
  const [needsPairing, setNeedsPairing] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [startErr, setStartErr] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TermHandle | null>(null);
  const sidRef = useRef<string>('');

  const loadPersona = useCallback(async () => {
    setPhase('loading'); setError(''); setNeedsPairing(false);
    const r = await window.opersona.getPersona();
    if (r.ok) { setPersona(r.persona); setPhase('ready'); }
    else { setError(r.error); setNeedsPairing(!!r.needsPairing); setPhase('error'); }
  }, []);

  useEffect(() => { void loadPersona(); }, [loadPersona]);

  const start = useCallback(async () => {
    if (!persona || !folder || !hostRef.current) return;
    setStartErr(null);
    const id = 'sess-' + Math.random().toString(36).slice(2);
    sidRef.current = id;
    setPhase('running');
    // mount terminal after the running layout paints
    requestAnimationFrame(() => {
      if (!hostRef.current) return;
      const h = mountTerminal(hostRef.current, id);
      handleRef.current = h;
      const { cols, rows } = h.fit();
      void window.opersona.startClaude({ id, cwd: folder, prompt: persona.prompt, model: model || undefined, cols, rows })
        .then((res) => { if (!res.ok) { setStartErr(res.error); } });
    });
  }, [persona, folder, model]);

  const stop = useCallback(() => {
    if (sidRef.current) window.opersona.kill(sidRef.current);
    handleRef.current?.dispose();
    handleRef.current = null;
    setPhase('ready');
  }, []);

  useEffect(() => () => { handleRef.current?.dispose(); }, []);

  return (
    <div style={S.app}>
      <div style={S.titlebar}>
        <span style={S.brand}>opersona</span>
        {persona && <span style={S.sub}>{persona.name ? `you are ${persona.name}` : 'your persona'}</span>}
        <span style={{ flex: 1 }} />
        {phase === 'running' && <button style={S.ghost} onClick={stop}>■ stop</button>}
        <button style={S.ghost} onClick={() => window.opersona.openSite('')}>opersona.me ↗</button>
      </div>

      {phase === 'loading' && <Center><p style={S.muted}>Loading your persona…</p></Center>}

      {phase === 'error' && (
        <Center>
          <p style={S.h}>Can’t load your persona</p>
          <p style={S.muted}>{error}</p>
          <div style={S.row}>
            <button style={S.primary} onClick={loadPersona}>Retry</button>
            {needsPairing && <button style={S.ghost} onClick={() => window.opersona.openSite('/settings#models')}>Pair this machine ↗</button>}
          </div>
        </Center>
      )}

      {phase === 'ready' && persona && (
        <Center>
          <p style={S.h}>Claude Code, thinking like {persona.name ?? 'you'}</p>
          <p style={S.muted}>
            Pick a folder. It runs the real Claude Code on your machine, on your own subscription,
            with your persona ({persona.promptHash}) as its system prompt. Every command asks you in the terminal.
          </p>
          <div style={S.row}>
            <button style={S.ghost} onClick={async () => setFolder(await window.opersona.chooseFolder())}>
              {folder ? '📁 ' + folder : 'Choose a folder…'}
            </button>
            <select style={S.select} value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <button style={{ ...S.primary, opacity: folder ? 1 : 0.5 }} disabled={!folder} onClick={start}>
            Start ▶
          </button>
          {startErr && <p style={S.err}>{startErr}</p>}
        </Center>
      )}

      <div style={{ ...S.termWrap, display: phase === 'running' ? 'block' : 'none' }}>
        {startErr && <p style={{ ...S.err, padding: '8px 12px' }}>{startErr}</p>}
        <div ref={hostRef} style={S.term} />
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={S.center}><div style={S.card}>{children}</div></div>;
}

const S: Record<string, React.CSSProperties> = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b0f', color: '#e6e6ea', fontFamily: '-apple-system, system-ui, sans-serif' },
  titlebar: { display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 12px 0 84px', borderBottom: '1px solid #1c1c24', WebkitAppRegion: 'drag' } as React.CSSProperties,
  brand: { fontWeight: 600, fontSize: 14 },
  sub: { fontSize: 12, color: '#8a8a95' },
  ghost: { WebkitAppRegion: 'no-drag', background: 'transparent', color: '#b8b8c0', border: '1px solid #2a2a34', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' } as React.CSSProperties,
  primary: { background: '#e6e6ea', color: '#0b0b0f', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  select: { background: '#15151c', color: '#e6e6ea', border: '1px solid #2a2a34', borderRadius: 8, padding: '6px 10px', fontSize: 12 },
  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center', alignItems: 'center' },
  h: { fontSize: 18, fontWeight: 600, margin: 0 },
  muted: { fontSize: 13, color: '#8a8a95', lineHeight: 1.5, margin: 0 },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  err: { fontSize: 12, color: '#ff8787', margin: 0 },
  termWrap: { flex: 1, minHeight: 0, background: '#0b0b0f' },
  term: { width: '100%', height: '100%', padding: 8, boxSizing: 'border-box' },
};
