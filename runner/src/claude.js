// Running Claude Code headless (`claude -p`): one prompt in, one answer out, no chat window.
import { run } from './shell.js';

// What Claude Code may never read, whatever else is allowed (on top of restricted mode keeping
// file tools inside the working folder)
const DENY = [
    'Read(//**/.env)', 'Read(//**/.env.*)', 'Read(//**/*.pem)', 'Read(//**/*.key)',
    'Read(//**/.ssh/**)', 'Read(//**/.aws/**)', 'Read(//**/.claude/**)',
];

// The environment Claude Code runs with: never the runner token. The API key only in "api" mode;
// in "pro" mode it must not be there, or Claude Code would bill the API instead of using your plan.
export function claudeEnv(auth)
{
    const env = { ...process.env };
    delete env.RUNNER_TOKEN;
    if (auth === 'pro') delete env.ANTHROPIC_API_KEY;
    return env;
}

// step: config.steps.refine or config.steps.build. tools: the only tools that exist for this run.
// allowedTools: which of them run without asking (the rest are refused: nobody is there to ask).
export async function runClaude({ config, step, cwd, prompt, systemPrompt, tools, allowedTools })
{
    const args = [
        '-p',
        '--output-format', 'json',
        '--model', step.model,
        '--max-budget-usd', String(step.maxBudgetUsd),
        '--max-turns', String(step.maxTurns),
        '--permission-mode', 'dontAsk', // anything not allowed below is refused, never asked
        '--restricted', // no command tools unless named, file tools stay in cwd, project .claude settings ignored
        '--strict-mcp-config', // no MCP servers (extra tools) at all
        '--tools', tools.join(','),
        '--settings', JSON.stringify({ permissions: { deny: DENY } }),
        '--append-system-prompt', systemPrompt,
        '--allowedTools', ...allowedTools, // last: it takes every argument after it
    ];

    const result = await run(config.claudePath, args, {
        cwd,
        env: claudeEnv(config.auth),
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
