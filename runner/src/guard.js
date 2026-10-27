#!/usr/bin/env node
// The guard: Claude Code runs this BEFORE every tool call (a "PreToolUse hook"), passing the call as JSON
// on stdin. Exit code 0 lets the call run; exit code 2 blocks it, and what we print on stderr tells Claude why.
// It is a second lock behind Claude Code's own permission rules: if one of them is ever wrong, the other holds.
//
// The runner tells it the rules through the environment:
//   RUNNER_WORKDIR           the only folder any file tool may touch (the task's worktree, or the project)
//   RUNNER_ALLOWED_COMMANDS  JSON list of the only Bash commands allowed, exactly as written
//   RUNNER_GUARD_LOG         (optional) a file where every decision is added as one line: what, allowed or blocked, why
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

// Files no tool may touch inside the project. (Everything outside the project is blocked anyway.)
// Checked on the path INSIDE the project only, so where the project folder itself lives doesn't matter.
const SECRET_FILE = /(^|\/)(\.env(\.[^/]*)?|\.git\/config|\.npmrc|\.netrc|id_rsa[^/]*|id_ed25519[^/]*|[^/]*\.pem|[^/]*\.key)$/i;
const SECRET_DIR = /(^|\/)(\.ssh|\.aws|\.gnupg|\.claude)(\/|$)/;

let current = { tool: null, detail: null }; // the call being checked, for the log

// One line per decision in RUNNER_GUARD_LOG. Logging must never change a decision, so failures are ignored.
function log(decision, reason)
{
    if (!process.env.RUNNER_GUARD_LOG) return;
    try
    {
        appendFileSync(process.env.RUNNER_GUARD_LOG, `${JSON.stringify({
            time: new Date().toISOString(), tool: current.tool, detail: current.detail, decision, reason,
        })}\n`);
    }
    catch { /* the log is a record, not a gate */ }
}

function block(reason)
{
    log('blocked', reason);
    process.stderr.write(`Blocked by the task runner: ${reason}`);
    process.exit(2);
}

// The real location of a path (following symlinks). For a file that doesn't exist yet, its nearest existing folder.
function realLocation(path)
{
    let current = path;
    while (!existsSync(current))
    {
        const parent = dirname(current);
        if (parent === current) return path;
        current = parent;
    }
    const real = realpathSync(current);
    return resolve(real, relative(current, path));
}

function checkPath(rawPath, cwd, root)
{
    if (typeof rawPath !== 'string' || !rawPath) block('a file tool was called without a path');
    const full = realLocation(isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath));
    const inside = relative(root, full);
    if (inside.startsWith('..') || isAbsolute(inside)) block(`${rawPath} is outside the project folder`);
    if (SECRET_FILE.test(inside) || SECRET_DIR.test(inside)) block(`${rawPath} may hold secrets`);
}

try
{
    const call = JSON.parse(readFileSync(0, 'utf8'));
    const root = realpathSync(process.env.RUNNER_WORKDIR);
    const allowedCommands = JSON.parse(process.env.RUNNER_ALLOWED_COMMANDS ?? '[]');
    const cwd = call.cwd ?? root;
    const input = call.tool_input ?? {};
    current = {
        tool: call.tool_name,
        detail: String(input.command ?? input.file_path ?? input.path ?? input.pattern ?? '').slice(0, 300),
    };

    switch (call.tool_name)
    {
        case 'Read':
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
            checkPath(input.file_path, cwd, root);
            break;
        case 'Glob':
        case 'Grep':
            checkPath(input.path ?? cwd, cwd, root);
            break;
        case 'Bash':
            if (!allowedCommands.includes(String(input.command ?? '').trim()))
            {
                block(`only these commands are allowed: ${allowedCommands.join(', ') || 'none'}`);
            }
            break;
        default:
            block(`the ${call.tool_name} tool isn't allowed here`);
    }
    log('allowed', null);
    process.exit(0);
}
catch (err)
{
    // Anything unexpected (bad JSON, missing settings...) blocks: the guard never fails open
    block(`the guard couldn't check this call (${err.message})`);
}
