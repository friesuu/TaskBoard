// The Claude runner: `pnpm once` does ONE step for ONE task, then stops. `pnpm watch` keeps doing that
// (one step at a time) until you stop it: see watch.js.
//   - a build you clicked Merge on  -> merge its branch into main (and e.g. runner-pro) -> Done. No Claude.
//   - a task you approved          -> build it on a new branch, check it, commit, summarise -> AI Review
//   - otherwise, an "AI" task that needs a prompt (new, or you asked for changes) -> write it -> Prompt Review
// Everything about which task and which step is decided by the task board, not here.
// Before any of that: is the runner paused (Pro usage limit)? Is today's spend cap (API) used up?
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { createApi } from './api.js';
import { run, stopChildren } from './shell.js';
import { checkProLogin } from './claude.js';
import { watch } from './watch.js';
import { releaseLock, takeLock } from './lock.js';
import { refine } from './refine.js';
import { build, checkProject, prepareMainCopy, prepareWorktree, removeWorktree, summaryComment } from './build.js';
import { merge, MergeRefused } from './merge.js';
import { parseReset, pause, pausedUntil } from './pause.js';
import { MIN_STEP_BUDGET_USD, spentToday, stepBudget } from './budget.js';
import { onBattery } from './power.js';
import { createRunLog } from './activity.js';

const say = (message) => console.log(`[runner] ${message}`);
const dollars = (amount) => `$${amount.toFixed(2)}`;
const HEARTBEAT_MS = 30 * 1000; // while a step runs, the board hears from the runner this often
// The runner's own secrets: never in a commit, never in the board's log
const knownSecrets = () => [process.env.ANTHROPIC_API_KEY, process.env.RUNNER_TOKEN];

// Records a finished step in logs/runs.log, which the daily cap adds up. (The board has its own record of
// each run: openRun and closeRun below.)
function record({ config, job, startedAt, entry })
{
    mkdirSync(dirname(config.logFile), { recursive: true });
    appendFileSync(config.logFile, `${JSON.stringify({
        time: new Date().toISOString(), taskId: job.task.id, step: job.kind.toLowerCase(), project: job.project,
        startedAt: startedAt.toISOString(), ...entry,
    })}\n`);
}

// Tells the board what the runner is doing (the AI Activity page and the cards). Never stops the runner.
async function tellBoard(api, status)
{
    if (!api) return;
    await api.reportStatus({ taskId: null, step: null, pausedUntil: null, ...status }).catch(() => {});
}

// The run on the board: opened when a step starts, so the AI Activity page shows it as running. null if the
// board couldn't open it (the step still goes ahead; it just has no log there).
async function openRun(api, job, branch = null)
{
    try
    {
        return await api.startRun(job.task.id, job.kind.toLowerCase(), branch);
    }
    catch (err)
    {
        say(`(Couldn't open the run on the board: ${err.message})`);
        return null;
    }
}

// Sends the rest of the run's log, then closes the run with how it went:
// { status: 'succeeded' | 'failed', result, checksPassed, costUsd, error, summary }
async function closeRun(api, runId, log, run)
{
    await log.close();
    if (runId === null) return;
    await api.finishRun(runId, {
        status: run.status,
        result: run.result,
        checksPassed: run.checksPassed ?? null,
        costUsd: run.costUsd ?? null,
        error: run.error ? run.error.slice(0, 2000) : null,
        summary: run.summary ? run.summary.slice(0, 20000) : null,
    }).catch((err) => say(`(Couldn't close the run on the board: ${err.message})`));
}

// Pro plan: stop until the limit resets, instead of pushing against it
function pauseForUsageLimit(config, usageLimit)
{
    const until = parseReset(usageLimit.resets);
    pause(config.pauseFile, until, `usage limit, resets ${usageLimit.resets}`);
    say(`Usage limit reached: paused until ${until.toLocaleString()}.`);
    return until;
}

// Everything that must be right before Claude Code is started
async function preflight(config)
{
    if (config.auth === 'api' && !process.env.ANTHROPIC_API_KEY?.trim())
    {
        throw new Error('config.json says "auth": "api", but ANTHROPIC_API_KEY in runner/.env is empty');
    }
    if (!process.env.RUNNER_TOKEN?.trim())
    {
        throw new Error('RUNNER_TOKEN in runner/.env is empty: create a runner token on your profile page');
    }
    const version = await run(config.claudePath, ['--version']);
    if (version.code !== 0) throw new Error(`Claude Code isn't working at ${config.claudePath}`);
    if (config.auth === 'pro')
    {
        const problem = await checkProLogin(config);
        if (problem) throw new Error(problem);
    }

    // The sandbox needs these. Without them nothing runs (and no task is touched): it never runs unprotected.
    for (const tool of ['bwrap', 'socat'])
    {
        if ((await run('sh', ['-c', `command -v ${tool}`])).code !== 0)
        {
            throw new Error(`${tool} isn't installed, and the sandbox needs it: sudo apt-get install -y ${tool === 'bwrap' ? 'bubblewrap' : tool}`);
        }
    }
}

async function doRefine({ job, project, config, api, startedAt })
{
    const runId = await openRun(api, job);
    const log = createRunLog({ api, runId, knownSecrets: knownSecrets() });
    // Every way out of this step closes the run (on the board) and records it (logs/runs.log)
    const finish = async (status, entry) => {
        await closeRun(api, runId, log, { status, ...entry });
        record({ config, job, startedAt, entry });
    };

    try
    {
        const problem = await checkProject(project);
        if (problem)
        {
            log.add('error', problem);
            await api.reportError(job.task.id, problem);
            say(`Stopped: ${problem}`);
            await finish('failed', { result: 'stopped', error: problem });
            return;
        }

        // Claude reads a fresh copy of main (the code the build will start from), not whatever is checked out
        log.add('info', `Reading the project on a fresh copy of ${project.baseBranch}`);
        const copy = await prepareMainCopy({ job, project, projectName: job.project, config });
        log.inFolder(copy);
        let result;
        try
        {
            result = await refine({ job, project: { ...project, path: copy }, config, onEvent: log.addEvent });
        }
        finally
        {
            await removeWorktree(project, copy);
        }
        const entry = { costUsd: result.costUsd };

        if (result.usageLimit) // leave the task alone; it's picked up again after the reset
        {
            const until = pauseForUsageLimit(config, result.usageLimit);
            log.add('error', `Usage limit reached: paused until ${until.toLocaleString()}`);
            await finish('failed', { ...entry, result: 'usage limit', error: `Paused until ${until.toLocaleString()}` });
            return;
        }
        if (result.refined)
        {
            await api.savePrompt(job.task.id, result.refined);
            log.add('info', 'Prompt saved: it is waiting for your approval');
            say('Prompt saved: the task is in Prompt Review.');
            await finish('succeeded', { ...entry, result: 'prompt saved' });
        }
        else
        {
            log.add('error', result.error);
            await api.reportError(job.task.id, result.error);
            say(`Stopped: ${result.error}`);
            await finish('failed', { ...entry, result: 'stopped', error: result.error });
        }
    }
    catch (err)
    {
        // The runner itself failed part-way (e.g. git): the run doesn't stay "running" on the board
        log.add('error', `The runner hit a problem and stopped: ${err.message}`);
        await finish('failed', { result: 'runner error', error: err.message });
        throw err;
    }
}

// What happened in a build, in a few words (for the logs)
function buildResultName(result)
{
    if (result.setupFailed) return 'setup failed';
    if (result.secretsFound?.length) return 'blocked: secret';
    if (result.outcome.usageLimit) return 'usage limit';
    return result.outcome.ok ? 'built' : 'stopped early';
}

async function doBuild({ job, project, config, api, startedAt })
{
    const problem = await checkProject(project);
    if (problem)
    {
        await api.reportError(job.task.id, problem);
        say(`Stopped: ${problem}`);
        const runId = await openRun(api, job);
        const log = createRunLog({ api, runId, knownSecrets: knownSecrets() });
        log.add('error', problem);
        await closeRun(api, runId, log, { status: 'failed', result: 'stopped', error: problem });
        record({ config, job, startedAt, entry: { result: 'stopped', error: problem } });
        return;
    }

    const { branch, worktree } = await prepareWorktree({ job, project, projectName: job.project, config });
    let runId = null;
    let log = null;
    try
    {
        await api.startBuild(job.task.id, branch); // marks the task, so it's never built twice
        say(`Working on branch ${branch}`);
        runId = await openRun(api, job, branch);
        log = createRunLog({ api, runId, knownSecrets: knownSecrets() });
        log.inFolder(worktree);
        log.add('info', `Working on branch ${branch}, a fresh copy of ${project.baseBranch}`);

        const result = await build({ job, project, config, branch, worktree, knownSecrets: knownSecrets(), log });
        if (result.outcome?.usageLimit) pauseForUsageLimit(config, result.outcome.usageLimit);

        const summary = result.setupFailed
            ? `I couldn't set up the project on branch ${branch}: ${result.setupFailed}`
            : summaryComment({ project, branch, result, auth: config.auth });
        const checksPassed = result.setupFailed || result.secretsFound?.length
            ? null
            : result.buildResult.code === 0 && result.testResult.code === 0;
        // It went fine: Claude finished, the checks passed and nothing was blocked. Otherwise it needs a look.
        const wentFine = checksPassed === true && result.outcome.ok;
        const resultName = buildResultName(result);
        const error = result.setupFailed
            ?? (result.secretsFound?.length ? 'Possible secret in the changes' : result.outcome?.error ?? null);

        await closeRun(api, runId, log, {
            status: wentFine ? 'succeeded' : 'failed', result: resultName, checksPassed,
            costUsd: result.outcome?.costUsd ?? null, error, summary,
        });
        await api.finishBuild(job.task.id, wentFine);
        say(`Done (${resultName}): the task is in AI Review.${wentFine ? '' : ' It needs a look: see the task.'}`);
        record({
            config, job, startedAt,
            entry: { result: resultName, branch, checksPassed, costUsd: result.outcome?.costUsd ?? null, error },
        });
    }
    catch (err)
    {
        // The runner itself failed part-way (e.g. git). Say so on the board, so it doesn't sit in In progress.
        if (log)
        {
            log.add('error', `The runner hit a problem and stopped: ${err.message}`);
            await closeRun(api, runId, log, { status: 'failed', result: 'runner error', error: err.message });
        }
        await api.finishBuild(job.task.id, false).catch(() => {});
        record({ config, job, startedAt, entry: { result: 'runner error', branch, error: err.message } });
        throw err;
    }
    finally
    {
        await removeWorktree(project, worktree);
    }
}

// Merges the branch you clicked Merge on. When it stops on purpose (a protected file, a conflict, uncommitted
// changes), the task says why and waits in AI Review: "Try again" after fixing it, or merge it by hand.
async function doMerge({ job, project, config, api, startedAt })
{
    const runId = await openRun(api, job, job.task.aiBranch);
    const log = createRunLog({ api, runId, knownSecrets: knownSecrets() });
    const finish = async (status, entry) => {
        await closeRun(api, runId, log, { status, ...entry });
        record({ config, job, startedAt, entry: { branch: job.task.aiBranch, ...entry } });
    };

    try
    {
        const problem = await checkProject(project);
        if (problem) throw new MergeRefused(problem);
        const { merged } = await merge({ job, project, projectName: job.project, config, log });
        await api.finishMerge(job.task.id);
        say(`Merged into ${merged.join(' and ')}: the task is Done.`);
        await finish('succeeded', { result: 'merged', summary: `Merged ${job.task.aiBranch} into ${merged.join(' and ')}.` });
    }
    catch (err)
    {
        const message = err instanceof MergeRefused ? err.message : `The runner hit a problem: ${err.message}`;
        log.add('error', message);
        await api.reportError(job.task.id, message).catch(() => {});
        say(`Not merged: ${message}`);
        await finish('failed', { result: 'not merged', error: message });
    }
}

// Today's cap for each step (API mode): the step's own cap, or what's left of the day's. null = used up.
function todaysBudgets(config)
{
    const caps = { refine: config.steps.refine.maxBudgetUsd, build: config.steps.build.maxBudgetUsd };
    if (config.auth !== 'api') return caps; // on the Pro plan the usage limit does this job
    const spent = spentToday(config.logFile);
    if (config.dailyCapUsd - spent < MIN_STEP_BUDGET_USD) return null;
    return {
        refine: stepBudget(caps.refine, config.dailyCapUsd, spent),
        build: stepBudget(caps.build, config.dailyCapUsd, spent),
    };
}

// At most one step for one task. Returns what happened, for watch mode:
//   { status: 'done' }  a step ran          { status: 'idle' }    nothing waiting
//   { status: 'paused', until }  Pro limit  { status: 'capped' }  today's spend cap used up
//   { status: 'busy' }  another runner holds the lock     { status: 'unplugged' } on battery
// quiet: say nothing about idle / paused / capped / busy (watch mode reports only changes)
async function runOneStep({ quiet = false } = {})
{
    const note = (message) => { if (!quiet) say(message); };
    const config = loadConfig();
    // The board hears what the runner is doing whenever it can (not before the token is set up)
    const token = process.env.RUNNER_TOKEN?.trim();
    const api = token ? createApi(config.taskBoardUrl, token) : null;
    const until = pausedUntil(config.pauseFile);
    // Paused or not, a merge you asked for still happens: it doesn't use Claude
    if (until && !(await runMergeIfWaiting({ config, api })))
    {
        await tellBoard(api, { state: 'paused', pausedUntil: until.toISOString() });
        note(`Paused until ${until.toLocaleString()} (usage limit). Nothing to do before then.`);
        return { status: 'paused', until };
    }
    if (until) return { status: 'done' };

    await preflight(config);
    try
    {
        await api.ping();
    }
    catch (err)
    {
        throw new Error(`Can't use the task board at ${config.taskBoardUrl}: ${err.message}`);
    }

    if (!takeLock(config.lockFile))
    {
        note('Another runner is already working. Stopping.');
        return { status: 'busy' };
    }
    try
    {
        const job = await api.nextJob();
        if (job?.kind === 'MERGE')
        {
            await doMergeJob({ job, config, api });
            return { status: 'done' };
        }

        const budgets = todaysBudgets(config);
        if (!budgets)
        {
            const spent = spentToday(config.logFile);
            note(`Today's spend cap is used up (${dollars(spent)} of ${dollars(config.dailyCapUsd)}). Waiting until tomorrow.`);
            await tellBoard(api, { state: 'capped' });
            return { status: 'capped' };
        }

        if (!job)
        {
            note('Nothing to do.');
            await tellBoard(api, { state: 'idle' });
            return { status: 'idle' };
        }
        if (await onBattery())
        {
            note('The laptop is on battery: nothing starts until it\'s plugged in.');
            await tellBoard(api, { state: 'unplugged' });
            return { status: 'unplugged' };
        }
        const startedAt = new Date();
        const stepName = job.kind === 'BUILD' ? 'build' : 'refine';
        say(`${job.kind === 'BUILD' ? 'Building' : 'Writing a prompt for'} task #${job.task.id} "${job.task.title}" `
            + `(project ${job.project}, cap ${dollars(budgets[stepName])})`);

        // This run's config: each step capped at today's budget
        const runConfig = {
            ...config,
            steps: {
                refine: { ...config.steps.refine, maxBudgetUsd: budgets.refine },
                build: { ...config.steps.build, maxBudgetUsd: budgets.build },
            },
        };

        const project = config.projects[job.project];
        if (!project)
        {
            const message = `The project "${job.project}" isn't in the runner's projects.json`;
            await api.reportError(job.task.id, message);
            say(`Stopped: ${message}`);
            record({ config, job, startedAt, entry: { result: 'stopped', error: message } });
            return { status: 'done' };
        }

        // The board shows what the runner is working on, and hears from it during a long step
        const working = { state: 'working', taskId: job.task.id, step: stepName };
        await tellBoard(api, working);
        const heartbeat = setInterval(() => tellBoard(api, working), HEARTBEAT_MS);
        try
        {
            if (job.kind === 'BUILD') await doBuild({ job, project, config: runConfig, api, startedAt });
            else await doRefine({ job, project, config: runConfig, api, startedAt });
        }
        finally
        {
            clearInterval(heartbeat);
            await tellBoard(api, { state: 'idle' });
        }
        return { status: 'done' };
    }
    finally
    {
        releaseLock(config.lockFile);
    }
}

// A merge job, with the board kept up to date: the runner is "working" on it until it's done
async function doMergeJob({ job, config, api })
{
    const startedAt = new Date();
    say(`Merging task #${job.task.id} "${job.task.title}" (${job.task.aiBranch})`);
    const project = config.projects[job.project];
    if (!project)
    {
        const message = `The project "${job.project}" isn't in the runner's projects.json`;
        await api.reportError(job.task.id, message);
        say(`Stopped: ${message}`);
        return;
    }
    await tellBoard(api, { state: 'working', taskId: job.task.id, step: 'merge' });
    try
    {
        await doMerge({ job, project, config, api, startedAt });
    }
    finally
    {
        await tellBoard(api, { state: 'idle' });
    }
}

// While paused for the usage limit: do a waiting merge, if there is one. true = it did one.
// Needs the board and the lock, but not Claude Code, so the Pro login isn't checked.
async function runMergeIfWaiting({ config, api })
{
    if (!api) return false;
    try
    {
        await api.ping();
    }
    catch
    {
        return false; // the board isn't reachable: say "paused" as usual and try again later
    }
    if (!takeLock(config.lockFile)) return false;
    try
    {
        const job = await api.nextJob();
        if (job?.kind !== 'MERGE') return false;
        await doMergeJob({ job, config, api });
        return true;
    }
    finally
    {
        releaseLock(config.lockFile);
    }
}

async function main()
{
    const mode = process.argv[2];
    if (mode === 'watch')
    {
        await watch({ runStep: () => runOneStep({ quiet: true }), stopChildren, say });
        return;
    }
    if (mode !== 'once')
    {
        console.log('Usage: pnpm once    (one step for one task, then stop)');
        console.log('       pnpm watch   (keep doing the next waiting step until you press Ctrl+C)');
        process.exitCode = 1;
        return;
    }

    // Ctrl+C during `pnpm once`: stop what's running too (the programs it started have their own process group)
    process.on('SIGINT', () => {
        stopChildren();
        say('Stopped. If a build was running, that task may need "Try again".');
        process.exit(130);
    });
    await runOneStep();
}

main().catch((err) => {
    console.error(`[runner] ${err.message}`);
    process.exitCode = 1;
});
