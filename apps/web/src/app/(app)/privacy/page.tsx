/**
 * The privacy promise, in plain words. This page exists so every member can see
 * exactly what is and isn't visible to others — enforcement over surveillance.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Privacy</h1>
        <p className="muted mt-1 text-sm">What others can see of you here — and what they can&apos;t. Enforced by the software, not by policy.</p>
      </header>

      <section className="card space-y-2 p-4">
        <h2 className="font-medium">Only you can see</h2>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>Your conversations — every chat with Claude or with your persona, live or past, including files they produce.</li>
          <li>Your persona&apos;s memory: episodes, the &ldquo;How I think&rdquo; patterns and their verbatim evidence quotes, self-tests, imports, and exports.</li>
          <li>There is no admin view of any of this. Not a hidden page, not an API. Org admins get metadata only (member list, usage totals).</li>
        </ul>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-medium">Visible to your teammates</h2>
        <ul className="muted list-disc space-y-1 pl-5 text-sm">
          <li>Your persona&apos;s public identity: name, Pixie, brief, personality, and documents you attach to it.</li>
          <li>Its self-test accuracy score.</li>
          <li><strong>When you ask a colleague&apos;s persona something, that conversation belongs to their persona — they can read it.</strong> (The same is true in reverse when someone asks yours.)</li>
        </ul>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-medium">Security without surveillance</h2>
        <p className="muted text-sm">
          Nobody reviews your chats to keep this server safe — the system prevents abuse instead of watching for it:
          chat code-execution runs in a kernel sandbox with no network and no host access, file tools are jailed to
          per-chat workspaces, sign-up is invite-only with mandatory two-factor auth, and privileged actions require
          explicit approval.
        </p>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-medium">The honest caveat</h2>
        <p className="muted text-sm">
          This is a self-hosted system. Whoever operates the machine can, like any IT administrator anywhere,
          technically access the underlying database. The application gives them no way to browse your content —
          that separation is a deliberate design promise, and this page is part of it.
        </p>
      </section>
    </div>
  );
}
