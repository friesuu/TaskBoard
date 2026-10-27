// Tests for the runner's own logic (no Claude, no task board). Run with: pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { between, outcomeOf } from '../src/claude.js';
import { parseReset, pause, pausedUntil } from '../src/pause.js';
import { spentToday, stepBudget } from '../src/budget.js';
import { findSecrets, redact } from '../src/secrets.js';
import { createActivityParser, createRunLog, describeTool } from '../src/activity.js';
import { slug, summaryComment } from '../src/build.js';
import { claudeSettings, proLoginProblem, sandboxDenyRead } from '../src/claude.js';
import { run, sandboxedCommand, stopChildren } from '../src/shell.js';
import { CHECK_EVERY_MS, nextCheckDelay, statusMessage } from '../src/watch.js';
import { isOnBattery } from '../src/power.js';
import { addPackageJson, removePlaceholders } from '../src/placeholders.js';
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

// ----- Watch mode -----

test('watch mode checks again at once after a step, and waits otherwise', () => {
    const now = new Date(2026, 9, 27, 14, 0);
    assert.equal(nextCheckDelay({ status: 'done' }, now), 0);
    assert.equal(nextCheckDelay({ status: 'idle' }, now), CHECK_EVERY_MS);
    assert.equal(nextCheckDelay({ status: 'error' }, now), CHECK_EVERY_MS);
    assert.equal(nextCheckDelay({ status: 'capped' }, now), 10 * 60 * 1000);
    // paused: until the reset, but never more than 5 minutes between checks
    assert.equal(nextCheckDelay({ status: 'paused', until: new Date(2026, 9, 27, 14, 2) }, now), 2 * 60 * 1000);
    assert.equal(nextCheckDelay({ status: 'paused', until: new Date(2026, 9, 27, 18, 0) }, now), 5 * 60 * 1000);
});

test('watch mode only speaks when something changes, and says nothing after a step', () => {
    assert.equal(statusMessage({ status: 'idle' }), 'Waiting for AI tasks…');
    assert.match(statusMessage({ status: 'error', error: 'backend down' }), /backend down/);
    assert.equal(statusMessage({ status: 'done' }), null);
});

test('stopping a program also stops everything it started', async () => {
    const started = Date.now();
    const pending = run('sh', ['-c', 'sleep 30 & sleep 30; echo never']);
    await new Promise((resolve) => setTimeout(resolve, 200));
    stopChildren();
    const result = await pending;
    assert.ok(Date.now() - started < 5000);
    assert.ok(!result.stdout.includes('never'));
});

// ----- Claude Code's placeholder files -----

// A throwaway git repository with these files committed
function tempRepo(files)
{
    const dir = mkdtempSync(join(tmpdir(), 'runner-placeholders-'));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'Start'], { cwd: dir });
    return dir;
}

test("Claude Code's empty placeholder files are deleted, and real files never are", async () => {
    const dir = tempRepo({ 'README.md': 'Hi\n', 'yarn.lock': '' }); // an empty file the project itself has
    mkdirSync(join(dir, 'frontend'));
    writeFileSync(join(dir, '.env.local'), '');
    writeFileSync(join(dir, '.npmrc'), '');
    writeFileSync(join(dir, '.env'), 'NAME=value\n'); // not empty: not a placeholder
    writeFileSync(join(dir, 'frontend', '.env.test'), ''); // not at the top: not a placeholder
    try
    {
        assert.deepEqual((await removePlaceholders(dir)).sort(), ['.env.local', '.npmrc']);
        for (const kept of ['yarn.lock', '.env', 'frontend/.env.test']) assert.ok(existsSync(join(dir, kept)), kept);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a project with no package.json at the top gets a valid one while Claude works, gone before the commit', async () => {
    const dir = tempRepo({ 'README.md': 'Hi\n' });
    try
    {
        addPackageJson(dir);
        assert.deepEqual(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')), {});
        assert.deepEqual(await removePlaceholders(dir), ['package.json']);
        assert.ok(!existsSync(join(dir, 'package.json')));
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("a project's own package.json is left alone", async () => {
    const dir = tempRepo({ 'package.json': '{ "name": "notes" }\n' });
    try
    {
        addPackageJson(dir);
        assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{ "name": "notes" }\n');
        assert.deepEqual(await removePlaceholders(dir), []);
    }
    finally
    {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ----- The Pro plan -----

test('on the Pro plan, the runner only starts when Claude Code is logged in to your subscription', () => {
    assert.match(proLoginProblem('{"loggedIn": false, "authMethod": "none"}'), /claude auth login/);
    assert.match(proLoginProblem('{"loggedIn": true, "authMethod": "console"}'), /API account, not your Pro plan/);
    assert.match(proLoginProblem('not json'), /Couldn't read/);
    assert.equal(proLoginProblem('{"loggedIn": true, "authMethod": "claude.ai"}'), null);
});

test("the task's comment says what a run used: dollars on the API, the plan's limit on Pro", () => {
    const result = {
        outcome: { ok: true, costUsd: 0.53, text: '<summary>Added shortcuts</summary>' },
        buildResult: { code: 0, stdout: '', stderr: '' },
        testResult: { code: 0, stdout: '', stderr: '' },
        changedFiles: 'M\tsrc/App.jsx',
        summary: 'Added shortcuts',
    };
    const project = { path: '/p', build: 'npm run build', test: 'npm test' };
    assert.match(summaryComment({ project, branch: 'ai/task-1-x', result }), /Cost of this run: \$0\.53/);
    assert.match(summaryComment({ project, branch: 'ai/task-1-x', result, auth: 'pro' }), /about \$0\.53 worth, counted toward your Pro plan's limit/);
});

// ----- Only while plugged in -----

test('nothing starts on battery, and watch mode checks again every 2 minutes', () => {
    assert.equal(isOnBattery('False\r\n'), true);
    assert.equal(isOnBattery('True\r\n'), false);
    assert.equal(isOnBattery(''), false); // no battery at all: a desktop
    assert.equal(nextCheckDelay({ status: 'unplugged' }), 2 * 60 * 1000);
    assert.match(statusMessage({ status: 'unplugged' }), /On battery/);
});

// ----- The step-by-step log on the board -----

test("Claude Code's streamed answer is read from its last line", () => {
    const stdout = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5-5' }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it' }] } }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'Done', total_cost_usd: 0.12 }),
    ].join('\n');
    const outcome = outcomeOf({ code: 0, stdout, stderr: '' });
    assert.deepEqual([outcome.ok, outcome.text, outcome.costUsd], [true, 'Done', 0.12]);
});

test('the log says what Claude said and did, shows command output, and never a file\'s contents', () => {
    const parse = createActivityParser(() => '/work/task-7');
    const said = parse({ type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'The search box goes in the header.' },
        { type: 'text', text: "I'll add the search box." },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/work/task-7/src/App.jsx' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } },
    ] } });
    assert.deepEqual(said, [
        { kind: 'thinking', text: 'The search box goes in the header.' },
        { kind: 'claude', text: "I'll add the search box." },
        { kind: 'tool', text: 'Read src/App.jsx' },
        { kind: 'tool', text: 'Ran npm test' },
    ]);
    const results = parse({ type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'const SECRET_FILE_CONTENTS = 1;' },
        { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'line 1\n# pass 8\n# fail 0' }] },
        { type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'Blocked by the guard: outside the project' },
    ] } });
    assert.deepEqual(results, [
        { kind: 'tool', text: '→ line 1\n# pass 8\n# fail 0' },
        { kind: 'error', text: 'Error: Blocked by the guard: outside the project' },
    ]);
    assert.equal(describeTool('Grep', { pattern: 'search', path: '/work/task-7/src' }, '/work/task-7'), 'Grep "search" in src');
});

test('secrets are hidden in the log: known ones exactly, and anything that looks like one', () => {
    const token = 'tbr_' + 'a'.repeat(40);
    const text = [
        `token ${token}`,
        `ANTHROPIC_API_KEY=sk-ant-api03-${'x'.repeat(30)}`,
        'DB_PASSWORD: hunter2',
        'postgres://app:hunter2@localhost/db',
        'my-own-secret-value-123 is fine to say',
    ].join('\n');
    assert.equal(redact(text, ['my-own-secret-value-123']), [
        'token [hidden]',
        'ANTHROPIC_API_KEY=[hidden]',
        'DB_PASSWORD: [hidden]',
        'postgres://app:[hidden]@localhost/db',
        '[hidden] is fine to say',
    ].join('\n'));
});

test('the log goes to the board a few lines at a time, in order, with secrets hidden', async () => {
    const sent = [];
    const api = { appendLog: async (runId, lines) => { sent.push([runId, lines.map((l) => `${l.kind}: ${l.text}`)]); } };
    const log = createRunLog({ api, runId: 7, knownSecrets: ['the-runner-token-123'], flushEveryMs: 60_000 });
    log.add('info', 'Setup: npm ci');
    log.addEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'Using the-runner-token-123' }] } });
    log.add('info', '   '); // nothing to say: left out
    await log.close();
    assert.deepEqual(sent, [[7, ['info: Setup: npm ci', 'claude: Using [hidden]']]]);

    // No run on the board, or the board unreachable: nothing breaks
    const quiet = createRunLog({ api, runId: null, flushEveryMs: 60_000 });
    quiet.add('info', 'not sent');
    await quiet.close();
    const warnings = [];
    const failing = createRunLog({
        api: { appendLog: async () => { throw new Error('board down'); } }, runId: 8, flushEveryMs: 60_000,
        say: (message) => warnings.push(message),
    });
    failing.add('info', 'one');
    await failing.close();
    assert.equal(sent.length, 1);
    assert.match(warnings[0], /board down/);
});
