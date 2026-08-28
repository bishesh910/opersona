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
          <li><strong>Your chats are sealed.</strong> Stored encrypted with a key only you hold. We keep ciphertext — we cannot read your conversations back, ever.</li>
          <li><strong>The thinking happens on your machine.</strong> With the bridge, your chats run through your own Claude, on your own computer, on the plan you already pay for.</li>
          <li><strong>What your persona learns stays yours.</strong> Visible to you, deletable by you, shared with nobody unless you choose to publish it.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">🔒 Sealed conversations</h2>
        <p className="text-sm">
          When you pair your first machine, your browser generates an encryption key and shows it to you once —
          <strong> the key never touches our servers</strong> (it travels to your app through a link your own
          computer handles locally). Every chat message is encrypted with it before being stored.
        </p>
        <p className="muted text-sm">What our database actually contains for a chat of yours:</p>
        <pre className="overflow-x-auto rounded bg-neutral-100 p-2 font-mono text-[11px] dark:bg-neutral-800">enc1:IxMOQ7XVJIXa…:LRqv4zpfrQZMMmnJiH…</pre>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>A leaked database, a stolen backup, or a curious operator gets exactly that: noise.</li>
          <li>Two honest limits: your messages do pass through the server&apos;s memory <em>live</em> (that&apos;s how they reach your model) — we just never store anything readable. And if you lose your key on every device, your sealed history is unreadable forever. Save it like a password.</li>
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
          <li>Rule of thumb: the <strong>diary is sealed, the résumé is readable</strong> — verbatim conversations encrypted, distilled insights not.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">Where the AI actually runs</h2>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>With the <strong>opersona bridge</strong> (one <code className="text-xs">npx opersona</code> command on your computer), your chats and your persona&apos;s learning run on <strong>your machine</strong>, through your own Claude login. That login never leaves your machine — nothing Anthropic-related ever reaches our servers.</li>
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
          <li><strong>If a teammate asks your persona a question</strong>, that conversation belongs to your persona — you can read it, and they know that.</li>
          <li><strong>The claude.ai connector</strong> only sees the tool calls your own Claude makes: a memory search here, an insight you asked it to save there. Your claude.ai conversations never stream to us.</li>
          <li><strong>We (the operators)</strong>: the app gives us no page, route, or API to read anyone&apos;s content — admins get metadata only (accounts, usage totals). Like any host anywhere, we could technically query the database — which is exactly why chats are sealed: the part you&apos;d worry about is ciphertext even to us. Backups are encrypted too.</li>
        </ul>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="font-medium">Security without surveillance</h2>
        <p className="muted text-sm">
          Nobody reviews content to keep this platform safe — the system prevents abuse instead of watching for it:
          chat code-execution runs in a kernel sandbox with no network access, file tools are jailed to per-chat
          workspaces, risky actions need your explicit approval, and the web can never run code on your paired
          machine — anything beyond reading its own scratch folder asks you first.
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
