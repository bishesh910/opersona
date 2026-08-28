function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card min-w-[7.25rem] shrink-0 px-3 py-2 sm:min-w-0 sm:shrink sm:py-3" title={hint}>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="muted text-[11px] leading-tight sm:text-xs">{label}</div>
    </div>
  );
}

export function StatStrip({ confirmed, emerging, chats, imported, claudeCode, accuracy, feedbackCount, accuracyPct, interviewAnswers }: {
  confirmed: number; emerging: number; chats: number; imported: number; claudeCode: number; accuracy: number | null; feedbackCount: number;
  /** 0–100 from the engine accuracy endpoint (chat feedback + self-tests), null when nothing rated. */
  accuracyPct: number | null;
  /** Interview answers given so far (undefined hides the tile for non-owner views). */
  interviewAnswers?: number;
}) {
  return (
    <div className="-mx-3 flex flex-nowrap gap-2 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-8">
      <Stat label="confirmed patterns" value={String(confirmed)} />
      <Stat label="emerging patterns" value={String(emerging)} />
      {interviewAnswers != null && <Stat label="interview answers" value={String(interviewAnswers)} hint="Questions answered on the Interview tab" />}
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
