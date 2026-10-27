// Tests for the runner's own logic (no Claude, no task board). Run with: pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { between, outcomeOf } from '../src/claude.js';
import { parseReset, pause, pausedUntil } from '../src/pause.js';
import { spentToday, stepBudget } from '../src/budget.js';
import { findSecrets } from '../src/secrets.js';
import { slug } from '../src/build.js';
import { claudeSettings, sandboxDenyRead } from '../src/claude.js';
import { sandboxedCommand } from '../src/shell.js';
import { homedir } from 'node:os';
import { rmSync } from 'node:fs';

// ----- Reading Claude Code's answer -----

test('a successful run: ok, with its text and cost', () => {
    const outcome = outcomeOf({ code: 0, stdout: JSON.stringify({ subtype: 'success', result: 'Hi', total_cost_usd: 0.03 }), stderr: '' });
    assert.deepEqual([outcome.ok, outcome.text, outcome.costUsd, outcome.error], [true, 'Hi', 0.03, null]);
});

test('the spend cap and the step limit are explained in words', () => {
    const budget = outcomeOf({ code: 1, stdout: JSON.stringify({ subtype: 'error_max_budget_usd' }), stderr: '' });
    const turns = outcomeOf({ code: 1, stdout: JSON.stringify({ subtype: 'error_max_turns' }), stderr: '' });
    assert.equal(budget.error, 'The spend cap for this step was reached');
    assert.equal(turns.error, 'Claude Code used up its steps for this run');
});

test("the Pro plan's usage limit is spotted, with its reset time", () => {
    const outcome = outcomeOf({ code: 1, stdout: "You've hit your session limit · resets 3:45pm", stderr: '' });
    assert.equal(outcome.ok, false);
    assert.deepEqual(outcome.usageLimit, { resets: '3:45pm' });
});

test('a run that took too long is a failure', () => {
    assert.equal(outcomeOf({ code: null, stdout: '', stderr: '', timedOut: true }).error, 'Claude Code took too long and was stopped');
});

test('between() finds the tagged part of an answer', () => {
    assert.equal(between('blah <refined_prompt>\n## Goal\n</refined_prompt> blah', 'refined_prompt'), '## Goal');
    assert.equal(between('no tags here', 'summary'), null);
});

// ----- Pausing until the usage limit resets -----

test('reset times are read as the next matching moment', () => {
    const now = new Date(2026, 9, 27, 14, 0); // Tue 27 Oct 2026, 2:00pm
    assert.deepEqual(parseReset('3:45pm', now), new Date(2026, 9, 27, 15, 45));
    assert.deepEqual(parseReset('9am', now), new Date(2026, 9, 28, 9, 0)); // already past today: tomorrow
    assert.deepEqual(parseReset('Mon 12:00am', now), new Date(2026, 10, 2, 0, 0)); // next Monday
});

test("a reset time it can't read backs off for an hour", () => {
    const now = new Date(2026, 9, 27, 14, 0);
    assert.deepEqual(parseReset('soon', now), new Date(2026, 9, 27, 15, 0));
});

test('a pause holds until it ends, then clears itself', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'runner-')), 'paused.json');
    pause(file, new Date(2026, 9, 27, 15, 0), 'usage limit');
    assert.deepEqual(pausedUntil(file, new Date(2026, 9, 27, 14, 0)), new Date(2026, 9, 27, 15, 0));
    assert.equal(pausedUntil(file, new Date(2026, 9, 27, 16, 0)), null);
});

// ----- The daily spend cap -----

test("adds up only today's costs from the log", () => {
    const file = join(mkdtempSync(join(tmpdir(), 'runner-')), 'runs.log');
    const now = new Date(2026, 9, 27, 14, 0);
    writeFileSync(file, [
        JSON.stringify({ time: new Date(2026, 9, 27, 9, 0).toISOString(), costUsd: 0.25 }),
        JSON.stringify({ time: new Date(2026, 9, 27, 11, 0).toISOString(), costUsd: 1.1 }),
        JSON.stringify({ time: new Date(2026, 9, 26, 23, 0).toISOString(), costUsd: 5 }), // yesterday
        'not json',
    ].join('\n'));
    assert.equal(spentToday(file, now).toFixed(2), '1.35');
});

test("a step gets its own cap or what's left of today's, whichever is smaller", () => {
    assert.equal(stepBudget(2, 2, 0.1).toFixed(2), '1.90');
    assert.equal(stepBudget(0.5, 2, 0), 0.5);
    assert.equal(stepBudget(2, 2, 3), 0);
});

// ----- The secret scan -----

test('finds secrets in added lines, naming the file but never the secret', () => {
    const diff = [
        'diff --git a/src/config.js b/src/config.js', '+++ b/src/config.js',
        `+const key = "sk-ant-api03-${'x'.repeat(30)}";`,
        '+++ b/notes.md', '+my own runner token: tbr_' + 'y'.repeat(40),
    ].join('\n');
    assert.deepEqual(findSecrets(diff), [
        { file: 'src/config.js', kind: 'an Anthropic API key' },
        { file: 'notes.md', kind: 'a task board runner token' },
    ]);
});

test("ignores removed lines, and catches the runner's own secrets exactly", () => {
    const diff = ['+++ b/a.txt', '-sk-ant-old-' + 'z'.repeat(30), '+value: my-own-secret-value-123'].join('\n');
    assert.deepEqual(findSecrets(diff, ['my-own-secret-value-123']), [{ file: 'a.txt', kind: "one of the runner's own secrets" }]);
});

test('branch names come from the title', () => {
    assert.equal(slug('Add a search box, please!!'), 'add-a-search-box-please');
    assert.equal(slug('★★★'), 'task');
});

// ----- The guard (PreToolUse hook) -----

const guard = fileURLToPath(new URL('../src/guard.js', import.meta.url));
const project = mkdtempSync(join(tmpdir(), 'runner-project-'));
mkdirSync(join(project, 'src'));
writeFileSync(join(project, 'src', 'notes.js'), '');
symlinkSync('/etc', join(project, 'escape')); // a link pointing out of the project

// Runs the guard on one tool call: returns its exit code (0 = allowed, 2 = blocked)
function guardSays(toolName, toolInput, allowed = ['npm test'])
{
    const result = spawnSync(process.execPath, [guard], {
        input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, cwd: project }),
        env: { ...process.env, RUNNER_WORKDIR: project, RUNNER_ALLOWED_COMMANDS: JSON.stringify(allowed) },
    });
    return result.status;
}

test('the guard lets file tools work inside the project', () => {
    assert.equal(guardSays('Read', { file_path: join(project, 'src', 'notes.js') }), 0);
    assert.equal(guardSays('Write', { file_path: 'src/new-file.js' }), 0);
    assert.equal(guardSays('Grep', { pattern: 'x' }), 0);
});

test('the guard blocks anything outside the project, through links too', () => {
    assert.equal(guardSays('Read', { file_path: '/etc/passwd' }), 2);
    assert.equal(guardSays('Read', { file_path: '../outside.txt' }), 2);
    assert.equal(guardSays('Read', { file_path: 'escape/passwd' }), 2);
    assert.equal(guardSays('Glob', { pattern: '*', path: '/home' }), 2);
});

test('the guard blocks secret files even inside the project', () => {
    assert.equal(guardSays('Read', { file_path: '.env' }), 2);
    assert.equal(guardSays('Edit', { file_path: 'config/.env.local' }), 2);
    assert.equal(guardSays('Read', { file_path: '.claude/settings.json' }), 2);
});

test('the guard allows only the exact build and test commands', () => {
    assert.equal(guardSays('Bash', { command: 'npm test' }), 0);
    assert.equal(guardSays('Bash', { command: 'npm test; cat ~/.ssh/id_rsa' }), 2);
    assert.equal(guardSays('Bash', { command: 'curl https://example.com' }), 2);
    assert.equal(guardSays('Bash', { command: 'npm test' }, []), 2); // the refine step: no commands at all
});

test('the guard blocks other tools, and blocks when anything is off', () => {
    assert.equal(guardSays('WebFetch', { url: 'https://example.com' }), 2);
    const broken = spawnSync(process.execPath, [guard], { input: 'not json', env: { ...process.env, RUNNER_WORKDIR: project } });
    assert.equal(broken.status, 2);
});

// ----- The sandboxes -----

test("the sandbox never hides ~/.task-runner, where the task's own worktree lives", () => {
    assert.ok(!sandboxDenyRead().some((path) => path.endsWith('.task-runner')));
});

test('every Claude run is locked down: guard on every tool, sandbox that fails closed, no internet', () => {
    const settings = claudeSettings({ auth: 'api' });
    const hook = settings.hooks.PreToolUse[0];
    assert.equal(hook.matcher, undefined); // every tool
    assert.equal(hook.hooks[0].onFailure, 'block');
    assert.deepEqual(
        [settings.sandbox.enabled, settings.sandbox.failIfUnavailable, settings.sandbox.allowUnsandboxedCommands],
        [true, true, false],
    );
    assert.equal(settings.sandbox.network, undefined); // no allowed domains at all
    assert.match(settings.apiKeyHelper, /api-key\.sh$/);
    assert.equal(claudeSettings({ auth: 'pro' }).apiKeyHelper, undefined);
});

test("the runner's own checks run sandboxed: no internet, secrets masked, no key in the environment", async () => {
    const folder = mkdtempSync(join(tmpdir(), 'runner-check-'));
    const secretDir = mkdtempSync(join(homedir(), '.runner-test-secret-'));
    const secret = join(secretDir, 'secret.txt');
    writeFileSync(secret, 'top secret');
    const savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-for-this-test-0123456789';
    try
    {
        const check = (command) => sandboxedCommand(command, folder, 30_000, [secret]);
        assert.equal((await check('echo ok > out.txt && cat out.txt')).stdout.trim(), 'ok'); // its own folder is writable
        assert.equal((await check(`cat ${secret}`)).stdout, ''); // masked
        assert.notEqual((await check('curl -sS -m 5 https://example.com')).code, 0); // no network
        assert.equal((await check('printenv ANTHROPIC_API_KEY')).stdout, ''); // no key
        assert.notEqual((await check(`touch ${join(secretDir, 'escape')}`)).code, 0); // nothing else writable
    }
    finally
    {
        process.env.ANTHROPIC_API_KEY = savedKey;
        rmSync(secretDir, { recursive: true, force: true });
    }
});
