// Running Claude Code headless (`claude -p`): one prompt in, one answer out, no chat window.
// Every run is locked down in layers, so one mistake in any of them isn't enough to cause harm:
//   1. --restricted, --tools and --allowedTools: only the tools and exact commands this step needs
//   2. the guard (src/guard.js), a hook that checks every single tool call before it runs
//   3. the sandbox around every command: no internet, and no reading the runner's or the board's secrets
//   4. no secrets in the environment: the API key reaches Claude Code only through bin/api-key.sh, and
//      Claude Code strips credentials from the environment of every command it runs
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RUNNER_DIR } from './config.js';
import { run } from './shell.js';

const GUARD = join(RUNNER_DIR, 'src', 'guard.js');
const API_KEY_HELPER = join(RUNNER_DIR, 'bin', 'api-key.sh');

// What Claude Code's own file tools may never read, whatever else is allowed
const DENY = [
    'Read(//**/.env)', 'Read(//**/.env.*)', 'Read(//**/*.pem)', 'Read(//**/*.key)',
    'Read(//**/.ssh/**)', 'Read(//**/.aws/**)', 'Read(//**/.claude/**)',
];

// What the commands Claude runs (e.g. npm test) may never read, inside the sandbox
export function sandboxDenyRead(extra = [])
{
    const home = homedir();
    return [
        join(RUNNER_DIR, '.env'), // the API key and the runner token
        join(home, 'task-board', 'backend', '.env'), // the board's database password and login secret
        join(home, '.claude'), join(home, '.ssh'), join(home, '.aws'), join(home, '.gnupg'),
        join(home, '.git-credentials'), join(home, '.npmrc'),
        // Not ~/.task-runner: the task's own worktree lives in there
        ...extra,
    ];
}

// The settings for one run (passed with --settings; --restricted ignores every other settings file)
export function claudeSettings(config, { denyReadExtra = [] } = {})
{
    return {
        // API mode: Claude Code asks this script for the key, so the key is never in an environment
        ...(config.auth === 'api' ? { apiKeyHelper: `sh ${API_KEY_HELPER}` } : {}),
        permissions: { deny: DENY },
        hooks: {
            // No matcher = every tool. onFailure "block": if the guard itself breaks, the call is refused.
            PreToolUse: [{
                hooks: [{ type: 'command', command: process.execPath, args: [GUARD], onFailure: 'block', timeout: 30 }],
            }],
        },
        sandbox: {
            enabled: true,
            failIfUnavailable: true, // no sandbox = no run (the default would quietly run without one)
            allowUnsandboxedCommands: false, // no way for a command to step outside it
            autoAllowBashIfSandboxed: false, // commands still need to be on the allowed list
            // No network settings: with no allowed domains, commands can't reach the internet at all
            filesystem: { denyRead: sandboxDenyRead(denyReadExtra) },
        },
    };
}

// The environment Claude Code runs with. Never the runner token. Never the API key either: in "api" mode
// it comes from apiKeyHelper; in "pro" mode it must not be there, or Claude Code would bill the API.
export function claudeEnv(config, { workdir, allowedCommands })
{
    const env = { ...process.env };
    delete env.RUNNER_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'; // strip credentials from every command's environment (and see placeholders.js)
    env.RUNNER_WORKDIR = workdir; // read by the guard
    env.RUNNER_ALLOWED_COMMANDS = JSON.stringify(allowedCommands);
    if (config.guardLogFile) env.RUNNER_GUARD_LOG = config.guardLogFile;
    return env;
}

// step: config.steps.refine or config.steps.build. tools: the only tools that exist for this run.
// allowedCommands: the exact Bash commands it may run (none for the refine step).
export async function runClaude({ config, step, cwd, prompt, systemPrompt, tools, allowedCommands = [], denyReadExtra = [] })
{
    const fileTools = tools.filter((tool) => tool !== 'Bash');
    const args = [
        '-p',
        '--output-format', 'json',
        '--model', step.model,
        '--max-budget-usd', String(step.maxBudgetUsd),
        '--max-turns', String(step.maxTurns),
        '--permission-mode', 'dontAsk', // anything not allowed below is refused, never asked
        '--restricted', // no command tools unless named, file tools stay in cwd, project .claude settings ignored
        '--strict-mcp-config', // no MCP servers (extra tools) at all...
        '--disallowedTools', 'mcp__*', // ...and none of their tools either
        '--tools', tools.join(','),
        '--settings', JSON.stringify(claudeSettings(config, { denyReadExtra })),
        '--append-system-prompt', systemPrompt,
        '--allowedTools', ...fileTools, ...allowedCommands.map((command) => `Bash(${command})`), // last: takes all after it
    ];

    const result = await run(config.claudePath, args, {
        cwd,
        env: claudeEnv(config, { workdir: cwd, allowedCommands }),
        input: prompt, // the prompt goes in on stdin, so it never has to fit on a command line
        timeoutMs: step.timeoutMinutes * 60 * 1000,
    });
    return outcomeOf(result);
}

// What happened, as { ok, text, costUsd, error, usageLimit }
export function outcomeOf(result)
{
    let json = null;
    try { json = JSON.parse(result.stdout); } catch { /* not JSON: an error before the run started */ }

    const text = (json?.result ?? result.stdout ?? '').trim();
    const allText = `${text}\n${result.stderr}`;
    const failed = result.code !== 0 || result.timedOut || json?.is_error === true
        || (typeof json?.subtype === 'string' && json.subtype !== 'success');

    // Pro plan only: "You've hit your session limit · resets 3:45pm" (not documented, so matched loosely)
    const limit = allText.match(/hit your (?:\w+ )?(?:session|weekly) limit[^\n]*?resets ([^\n.]+)/i);

    let error = null;
    if (result.timedOut) error = 'Claude Code took too long and was stopped';
    else if (json?.subtype === 'error_max_budget_usd') error = 'The spend cap for this step was reached';
    else if (json?.subtype === 'error_max_turns') error = 'Claude Code used up its steps for this run';
    else if (failed) error = (text || result.stderr.trim() || `Claude Code exited with code ${result.code}`).slice(0, 500);

    return {
        ok: !failed,
        text,
        costUsd: typeof json?.total_cost_usd === 'number' ? json.total_cost_usd : null,
        error,
        usageLimit: limit ? { resets: limit[1].trim() } : null,
    };
}

// The text between <tag> and </tag> in Claude's answer, or null
export function between(text, tag)
{
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : null;
}
