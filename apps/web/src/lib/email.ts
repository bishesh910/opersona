/**
 * Outbound email via Resend's plain HTTP API (no SDK). Unconfigured installs
 * no-op with a console warning, so every email feature degrades gracefully:
 * verification simply isn't required and reset links aren't offered.
 */
const API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM = process.env.EMAIL_FROM ?? '';

/** True when this install can actually send email. */
export const MAILER_ON = !!(API_KEY && FROM);

export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  if (!MAILER_ON) { console.warn(`[email] mailer unconfigured — would have sent "${msg.subject}" to ${msg.to}`); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`email send failed (${res.status}): ${body.slice(0, 300)}`);
  }
}
