// Claude Code's placeholder files. With CLAUDE_CODE_SUBPROCESS_ENV_SCRUB set (claude.js sets it), its sandbox
// write-protects these files in the folder it works in, and creates any that are missing as EMPTY files so
// tools can still read them. In a normal checkout it hides them from git (.git/info/exclude), but that
// doesn't work in a worktree, so the runner cleans up after it. Otherwise:
// - they'd be committed with the task's changes
// - an empty package.json isn't valid JSON, and breaks the build and tests (Vitest reads it, for one)
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './shell.js';

// The names Claude Code lists in .git/info/exclude ("claude-code scrub-mode stubs")
export const PLACEHOLDERS = [
    'bunfig.toml', 'package.json', '.npmrc', '.yarnrc', '.yarnrc.yml', '.gitmodules', 'package-lock.json',
    'yarn.lock', 'pnpm-lock.yaml', '.env', '.env.local', '.env.development', '.env.development.local',
    '.env.test', '.env.test.local', '.env.production', '.env.production.local',
];

// What the runner puts in a package.json the project doesn't have
const RUNNER_PACKAGE_JSON = '{}\n';

// Before Claude starts: a valid package.json at the top if the project has none (e.g. the task board, which
// has one in backend/ and frontend/ only), so Claude Code doesn't make an empty one that breaks Claude's tests
export function addPackageJson(worktree)
{
    const path = join(worktree, 'package.json');
    if (!existsSync(path)) writeFileSync(path, RUNNER_PACKAGE_JSON);
}

// After Claude finishes, before the checks and the commit: deletes the placeholders at the top of the worktree.
// Only files git doesn't know about that are empty (or the runner's own package.json), so a real file is
// never touched. Returns the names it deleted.
export async function removePlaceholders(worktree)
{
    const tracked = new Set((await git(worktree, ['ls-files', '--', ...PLACEHOLDERS])).split('\n'));
    const removed = [];
    for (const name of PLACEHOLDERS)
    {
        const path = join(worktree, name);
        if (tracked.has(name) || !existsSync(path) || !lstatSync(path).isFile()) continue;
        const content = readFileSync(path, 'utf8');
        if (content !== '' && !(name === 'package.json' && content === RUNNER_PACKAGE_JSON)) continue;
        rmSync(path);
        removed.push(name);
    }
    return removed;
}
