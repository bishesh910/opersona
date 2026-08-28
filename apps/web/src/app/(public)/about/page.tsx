import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — opersona",
  description:
    "Your AI persona learns how you think, runs on your own Claude, and is shared only when you decide. What opersona is, why we built it, and what we refuse to do.",
};

/** A quiet nod to the pixie avatars: five square "pixels" fading in and out. */
function PixelDivider() {
  return (
    <div aria-hidden="true" className="flex items-center gap-1">
      {["opacity-25", "opacity-50", "opacity-100", "opacity-50", "opacity-25"].map((o, i) => (
        <span key={i} className={`h-1.5 w-1.5 bg-neutral-400 dark:bg-neutral-600 ${o}`} />
      ))}
    </div>
  );
}

const linkClass =
  "font-medium underline underline-offset-4 decoration-neutral-400 hover:decoration-current dark:decoration-neutral-600";

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-10 py-4">
      <header className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">About opersona</h1>
        <p className="text-lg">
          opersona is where your AI persona learns <em>how</em> you think — your reasoning patterns, the
          facts you confirm, the playbooks you repeat — from the conversations and work you already do.
          It runs on your own Claude, not on ours.
        </p>
        <PixelDivider />
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Why we built it</h2>
        <p className="text-sm">
          Most AI &ldquo;memory&rdquo; is rented. It lives on a company&rsquo;s servers, is readable by
          that company, and disappears when you stop paying. We think that&rsquo;s backwards. How you
          think is the most personal thing software has ever touched, and you shouldn&rsquo;t have to
          rent it from a company that reads your life.
        </p>
        <p className="text-sm">
          So we built the opposite. A persona that is yours: it learns from work you were doing anyway,
          runs on compute you already own, and is shared only when you decide, on your terms. Everything
          else about opersona follows from that.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">How it actually works</h2>

        <div className="card space-y-2 p-5">
          <span className="chip">1 · learn</span>
          <h3 className="font-medium">It learns from work you already do</h3>
          <p className="muted text-sm">
            As you chat, work, and answer its interview — your persona messages you about real
            moments and follows the threads — it distills how you reason: patterns, confirmed facts,
            playbooks. It runs on your own Claude: the opersona bridge on your machine (one{" "}
            <code className="text-xs">npx opersona</code> command using the Claude subscription you
            already have — your login never leaves your computer), an API key you provide, or as a
            connector inside claude.ai, where saying &ldquo;opersona me&rdquo; starts your interview.
            There is no platform API key. Nobody&rsquo;s thinking is billed to us.
          </p>
        </div>

        <div className="card space-y-2 p-5">
          <span className="chip">2 · sealed vs. learned</span>
          <h3 className="font-medium">Two layers, split on purpose</h3>
          <p className="muted text-sm">
            Chat transcripts are sealed: encrypted with AES-256-GCM using a key generated in your
            browser that never touches our servers. We store ciphertext we cannot read. What your
            persona <em>learns</em> stays readable, deliberately — it is the product. You review it,
            edit it, and delete it whenever you like.
          </p>
        </div>

        <div className="card space-y-2 p-5">
          <span className="chip">3 · share</span>
          <h3 className="font-medium">Sharing stays yours to control</h3>
          <p className="muted text-sm">
            Publishing gives others a copy of your persona in their workspace. It thinks like you, runs
            on <em>their</em> Claude, and never learns anything more about you — it contains only what
            you explicitly marked shareable. Make it public or restrict it to people you choose, and
            unpublish any time. It&rsquo;s portable too: a <code className="text-xs">.persona.json</code>{" "}
            file you can take with you. You can leave with everything.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">What we refuse to do</h2>
        <div className="card p-5">
          <ul className="space-y-4 text-sm">
            <li>
              <p className="font-medium">Read your chats.</p>
              <p className="muted">
                Transcripts are encrypted with a key we never had. Enforced by code, not by a paragraph
                in a policy.
              </p>
            </li>
            <li>
              <p className="font-medium">Hold your Claude login.</p>
              <p className="muted">
                The bridge runs on your machine. Your credentials stay there. We never see them.
              </p>
            </li>
            <li>
              <p className="font-medium">Spend your money on strangers.</p>
              <p className="muted">
                Copies of your persona run on the copier&rsquo;s own Claude. There is no platform key
                quietly metering anyone in the background.
              </p>
            </li>
            <li>
              <p className="font-medium">Editorialize what you publish.</p>
              <p className="muted">
                A published persona contains exactly what you marked shareable — nothing added, nothing
                tuned, nothing promoted over anything else.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Who can join</h2>
        <p className="text-sm">
          Sign-ups are open, but we admit accounts gradually — a human approves every one.
          That&rsquo;s deliberate. We&rsquo;d rather stay small, honest, and personal than
          growth-hacked. If you sign up, expect a short wait.
        </p>
      </section>

      <footer className="space-y-4">
        <PixelDivider />
        <p className="text-sm">If any of this sounds like how software should treat you:</p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li><Link href="/privacy" className={linkClass}>Privacy, honestly</Link></li>
          <li>
            <Link href="/sign-up" className={linkClass}>Sign up</Link>{" "}
            <span className="muted">(a human will approve you — expect a wait)</span>
          </li>
        </ul>
        <p className="muted text-sm">Last updated August 2026</p>
      </footer>
    </article>
  );
}
