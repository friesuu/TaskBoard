// The secret scan: before anything is committed, the runner looks through the lines being ADDED for
// anything that looks like a secret. If it finds one, nothing is committed. The report names the file
// and the kind of secret, never the secret itself.

const PATTERNS = [
    { kind: 'an Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
    { kind: 'a task board runner token', pattern: /tbr_[A-Za-z0-9_-]{20,}/ },
    { kind: 'a private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { kind: 'an AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { kind: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
];

// diff: the output of `git diff --cached`. knownSecrets: exact values that must never appear
// (e.g. this runner's own key and token). Returns [{ file, kind }], empty when clean.
export function findSecrets(diff, knownSecrets = [])
{
    const known = knownSecrets.filter((s) => typeof s === 'string' && s.length >= 12);
    const found = [];
    let file = null;

    for (const line of diff.split('\n'))
    {
        if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
        if (!line.startsWith('+')) continue; // only lines being added
        const text = line.slice(1);
        if (known.some((secret) => text.includes(secret))) found.push({ file, kind: "one of the runner's own secrets" });
        for (const { kind, pattern } of PATTERNS)
        {
            if (pattern.test(text)) found.push({ file, kind });
        }
    }
    // One entry per file and kind
    return found.filter((f, i) => found.findIndex((g) => g.file === f.file && g.kind === f.kind) === i);
}

// .env-style lines whose name says they're secret (API_KEY=..., DB_PASSWORD: ...), and passwords inside
// addresses (postgres://user:password@host)
const ASSIGNMENT = /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS))(\s*[=:]\s*)\S+/g;
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

// For the step-by-step log on the board: the text with anything that looks like a secret, and the
// runner's own secrets exactly, replaced by [hidden]. (The board scrubs it again before saving it.)
export function redact(text, knownSecrets = [])
{
    let out = text.replace(PRIVATE_KEY_BLOCK, '[hidden]');
    for (const secret of knownSecrets.filter((s) => typeof s === 'string' && s.length >= 12)) out = out.split(secret).join('[hidden]');
    for (const { pattern } of PATTERNS) out = out.replace(new RegExp(pattern.source, 'g'), '[hidden]');
    return out.replace(ASSIGNMENT, '$1$2[hidden]').replace(URL_PASSWORD, '$1[hidden]@');
}
