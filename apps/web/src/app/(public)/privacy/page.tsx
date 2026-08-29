import Link from 'next/link';

export const metadata = { title: 'Privacy — opersona' };

/**
 * The privacy contract, in plain words, readable BEFORE signing up.
 * Everything here is enforced by the software; nothing is marketing.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy, honestly</h1>
        <p className="muted mt-2 text-sm">
          No legalese. This page says exactly what happens to your data — including the parts
          other products don&apos;t like to mention. Everything below is enforced by code, not policy.
        </p>
      </header>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">The short version</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li><strong>Your conversations are not stored here. At all.</strong> Talking happens on claude.ai (your account, their storage) and on your own machine — our database never holds a chat transcript.</li>
          <li><strong>The thinking happens on your machine.</strong> With the bridge, your persona&apos;s learning runs through your own Claude, on your own computer, on the plan you already pay for.</li>
          <li><strong>What your persona learns stays yours.</strong> Visible to you, deletable by you, shared with nobody unless you choose to publish it.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">🔒 No conversations, no problem</h2>
        <p className="text-sm">
          opersona.me has no chat. You talk to (and as) your persona on <strong>claude.ai</strong>, through
          the opersona connector — those conversations live in your Claude account under Anthropic&apos;s
          terms, and they <strong>never stream to us</strong>. The only thing that reaches our server is the
          individual tool calls your own Claude chooses to make: a memory search, an insight you asked it to
          save, an interview answer you gave.
        </p>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>A leaked database or a stolen backup contains no conversation of yours — there is nothing to leak.</li>
          <li>One honest limit: what a tool call carries (an interview answer, a saved insight) is by design readable — that is the persona&apos;s memory, covered below.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">What your persona learns — the &ldquo;résumé&rdquo;</h2>
        <p className="text-sm">
          Your persona distills <em>how you think</em> into short entries: facts (&ldquo;prefers evidence-first answers&rdquo;),
          reasoning patterns, playbooks, and one-paragraph summaries of past work. These stay readable on the server
          <strong> on purpose</strong> — they are what powers your persona&apos;s memory, the claude.ai connector, and
          (only if you choose) sharing.
        </p>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>Every entry is visible to you, with its origin, and deletable in one click.</li>
          <li><strong>The interview lives on this side.</strong> What you tell your persona in the interview — including your exact words, kept as evidence — is stored readable, because it <em>is</em> the persona&apos;s memory. It follows the same rules: visible to you, never shared unless you mark it shareable, gone when you delete it.</li>
          <li>Rule of thumb: <strong>conversations stay where they happened; only the résumé lives here</strong> — and you can read every line of it.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">Where the AI actually runs</h2>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>With the <strong>opersona bridge</strong> (one <code className="text-xs">npx opersona</code> command on your computer), your persona&apos;s learning — interview extraction, imports, lessons from your coding sessions — runs on <strong>your machine</strong>, through your own Claude login. That login never leaves your machine — nothing Anthropic-related ever reaches our servers.</li>
          <li>With an API key instead: the key is stored encrypted (AES-256-GCM) and used only for your own workspace&apos;s requests.</li>
          <li>Selfies for your Pixie are processed in memory and <strong>never stored</strong> — only the resulting cartoon recipe is saved.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">Imports are temporary</h2>
        <p className="muted text-sm">
          Upload a claude.ai or ChatGPT export and the file is <strong>deleted the moment learning finishes</strong>
          (24 hours at the absolute most, even if something fails). Your coding sessions picked up by the bridge are
          processed the same way — mined for insights on your own machine, never stored as transcripts.
        </p>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">Who sees what</h2>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li><strong>Other people: nothing</strong>, unless you explicitly publish your persona — section by section, with a full preview of exactly what leaves, never your conversations. Unpublish any time.</li>
          <li><strong>If a teammate talks to your persona</strong>, it happens through their own claude.ai and <code className="text-xs">use_persona</code>, which serves only what you marked shareable. Their conversation is theirs; your private model never leaves.</li>
          <li><strong>The claude.ai connector</strong> only sees the tool calls your own Claude makes: a memory search here, an insight you asked it to save there. Even &ldquo;learn from this chat&rdquo; sends only the distilled lessons (with short quotes of your words) — your Claude does the distilling inside the chat, and the conversation itself never reaches us.</li>
          <li><strong>We (the operators)</strong>: the app gives us no page, route, or API to read anyone&apos;s content — admins get metadata only (accounts, usage totals). Like any host anywhere, we could technically query the database — which is exactly why it holds no conversations: the part you&apos;d worry about simply isn&apos;t in it. Backups are encrypted too.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">Security without surveillance</h2>
        <p className="muted text-sm">
          Nobody reviews content to keep this platform safe — the system prevents abuse instead of watching for it:
          there is no content to watch (no conversations stored), the connector serves non-owners only what was
          explicitly marked shareable, and the web can never run code on your paired machine — the bridge offers
          the server no such capability.
        </p>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">Your exit, any time</h2>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>Export your persona and its memory from the app.</li>
          <li>Delete your persona or your whole account yourself, in Settings → Account. Everything goes — workspace, persona, memory, files on disk — permanently, the moment you confirm.</li>
          <li>Don&apos;t trust our server at all? opersona is <strong>self-hostable by design</strong> — run the same product on your own machine.</li>
        </ul>
      </section>

      <p className="muted text-xs">
        This page changes only when the software changes. Last updated August 2026 · <Link href="/sign-up" className="underline underline-offset-2">Create your persona</Link>
      </p>
    </div>
  );
}
