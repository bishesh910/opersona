function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card py-3" title={hint}>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="muted text-xs">{label}</div>
    </div>
  );
}

export function StatStrip({ confirmed, emerging, chats, imported, claudeCode, accuracy, feedbackCount, accuracyPct }: {
  confirmed: number; emerging: number; chats: number; imported: number; claudeCode: number; accuracy: number | null; feedbackCount: number;
  /** 0–100 from the engine accuracy endpoint (chat feedback + self-tests), null when nothing rated. */
  accuracyPct: number | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <Stat label="confirmed patterns" value={String(confirmed)} />
      <Stat label="emerging patterns" value={String(emerging)} />
      <Stat label="chats learned from" value={String(chats)} />
      <Stat label="conversations imported" value={String(imported)} />
      <Stat label="Claude Code sessions" value={String(claudeCode)} hint="Claude Code sessions your persona has learned from" />
      <Stat
        label="sounds like me"
        value={accuracy == null ? '—' : `${Math.round(accuracy * 100)}%`}
        hint={feedbackCount ? `${feedbackCount} replies rated in Chat` : 'Rate replies in Chat with “That’s me” / “Not me”'}
      />
      <Stat
        label="accuracy"
        value={accuracyPct == null ? '—' : `${accuracyPct}%`}
        hint="Share of everything you rated — chat replies and self-tests — that sounded like you"
      />
    </div>
  );
}
