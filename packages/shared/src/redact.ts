/**
 * Strip secret-shaped substrings out of free text before it is stored or sent to
 * a model.
 *
 * Deliberately CONSERVATIVE: matches known credential SHAPES (provider key
 * prefixes, JWTs, PEM private keys, bearer tokens) and sensitive key=value /
 * key: value assignments, replacing the secret with `[redacted]`. It does NOT
 * blanket-redact on entropy, so git SHAs, ids, file paths and prose survive.
 */
export function redactSecrets(text: unknown): string {
  if (typeof text !== 'string' || !text) return typeof text === 'string' ? text : '';
  let s = text;
  // 1. PEM private-key blocks.
  s = s.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[redacted]');
  // 2. JSON Web Tokens.
  s = s.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[redacted]');
  // 3. Known credential prefixes (OpenAI/Anthropic, Slack, GitHub, AWS, Google).
  s = s.replace(
    /(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|xox[bpaors]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|gh[posru]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{20,})/g,
    '[redacted]',
  );
  // 4. Bearer tokens — keep the label, drop the credential.
  s = s.replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]');
  // 5. Sensitive key = value / key: value — keep the key name, drop the value.
  s = s.replace(
    /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|secret[_-]?access[_-]?key|secret|token|password|passwd|pwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|signing[_-]?secret|webhook[_-]?secret|auth[_-]?token|bot[_-]?token|private[_-]?key))(\s*[:=]\s*)(["']?)[^\s"',}]{6,}\3/gi,
    (_m, k) => `${k}=[redacted]`,
  );
  return s;
}
