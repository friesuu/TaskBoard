// Scrubs anything that looks like a secret out of what the runner sends (log lines, summaries, errors)
// before it's saved. The runner already does this on your laptop (runner/src/secrets.js); this is the
// second lock, in case one slips through there.
const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic API keys
  /tbr_[A-Za-z0-9_-]{20,}/g, // task board runner tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access keys
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, // private keys
];

// .env-style lines whose name says they're secret: API_KEY=..., DB_PASSWORD: ..., JWT_SECRET=...
const ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS))(\s*[=:]\s*)\S+/g;

// A password inside an address: postgres://user:password@host
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi;

export function redact(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) out = out.replace(pattern, '[hidden]');
  return out.replace(ASSIGNMENT, '$1$2[hidden]').replace(URL_PASSWORD, '$1[hidden]@');
}
