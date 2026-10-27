// The Claude runner: `pnpm once` does ONE step for ONE task, then stops.
//   - a task you approved          -> build it on a new branch, check it, commit, summarise -> AI Review
//   - otherwise, an "AI" task that needs a prompt (new, or you asked for changes) -> write it -> Prompt Review
// Everything about which task and which step is decided by the task board, not here.
// Before any of that: is the runner paused (Pro usage limit)? Is today's spend cap (API) used up?
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { createApi } from './api.js';
import { run } from './shell.js';
import { releaseLock, takeLock } from './lock.js';
import { refine } from './refine.js';
import { build, checkProject, prepareMainCopy, prepareWorktree, removeWorktree, summaryComment } from './build.js';
import { parseReset, pause, pausedUntil } from './pause.js';
import { MIN_STEP_BUDGET_USD, spentToday, stepBudget } from './budget.js';

const say = (message) => console.log(`[runner] ${message}`);
const dollars = (amount) => `$${amount.toFixed(2)}`;

// Records a finished step in two places: a line in logs/runs.log (which the daily cap adds up), and the
// task's run log on the board. A failure to reach the board's log never stops the runner.
async function record({ config, api, job, startedAt, entry })
{
    const step = job.kind.toLowerCase();
    mkdirSync(dirname(config.logFile), { recursive: true });
    appendFileSync(config.logFile, `${JSON.stringify({
        time: new Date().toISOString(), taskId: job.task.id, step, project: job.project, ...entry,
    })}\n`);
    await api.logRun(job.task.id, {
        step,
        result: entry.result,
        branch: entry.branch ?? null,
        checksPassed: entry.checksPassed ?? null,
        costUsd: entry.costUsd ?? null,
        error: entry.error ?? null,
        startedAt: startedAt.toISOString(),
    }).catch((err) => say(`(Couldn't add this run to the task's log: ${err.message})`));
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
    const problem = await checkProject(project);
    if (problem)
    {
        await api.reportError(job.task.id, problem);
        say(`Stopped: ${problem}`);
        await record({ config, api, job, startedAt, entry: { result: 'stopped', error: problem } });
        return;
    }

    // Claude reads a fresh copy of main (the code the build will start from), not whatever is checked out
    const copy = await prepareMainCopy({ job, project, projectName: job.project, config });
    let result;
    try
    {
        result = await refine({ job, project: { ...project, path: copy }, config });
    }
    finally
    {
        await removeWorktree(project, copy);
    }
    const entry = { costUsd: result.costUsd };

    if (result.usageLimit) // leave the task alone; it's picked up again after the reset
    {
        const until = pauseForUsageLimit(config, result.usageLimit);
        await record({ config, api, job, startedAt, entry: { ...entry, result: 'usage limit', error: `Paused until ${until.toLocaleString()}` } });
        return;
    }
    if (result.refined)
    {
        await api.savePrompt(job.task.id, result.refined);
        say('Prompt saved: the task is in Prompt Review.');
        await record({ config, api, job, startedAt, entry: { ...entry, result: 'prompt saved' } });
    }
    else
    {
        await api.reportError(job.task.id, result.error);
        say(`Stopped: ${result.error}`);
        await record({ config, api, job, startedAt, entry: { ...entry, result: 'stopped', error: result.error } });
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
        await record({ config, api, job, startedAt, entry: { result: 'stopped', error: problem } });
        return;
    }

    const { branch, worktree } = await prepareWorktree({ job, project, projectName: job.project, config });
    try
    {
        await api.startBuild(job.task.id, branch); // marks the task, so it's never built twice
        say(`Working on branch ${branch}`);

        const result = await build({
            job, project, config, branch, worktree,
            knownSecrets: [process.env.ANTHROPIC_API_KEY, process.env.RUNNER_TOKEN],
        });
        if (result.outcome?.usageLimit) pauseForUsageLimit(config, result.outcome.usageLimit);

        const summary = result.setupFailed
            ? `I couldn't set up the project on branch ${branch}: ${result.setupFailed}`
            : summaryComment({ project, branch, result });
        await api.finishBuild(job.task.id, summary);

        const checksPassed = result.setupFailed || result.secretsFound?.length
            ? null
            : result.buildResult.code === 0 && result.testResult.code === 0;
        const resultName = buildResultName(result);
        say(`Done (${resultName}): the task is in AI Review.${checksPassed === false ? ' The checks failed: see the task.' : ''}`);
        await record({
            config, api, job, startedAt,
            entry: {
                result: resultName, branch, checksPassed, costUsd: result.outcome?.costUsd ?? null,
                error: result.setupFailed ?? (result.secretsFound?.length ? 'Possible secret in the changes' : result.outcome?.error ?? null),
            },
        });
    }
    catch (err)
    {
        // The runner itself failed part-way (e.g. git). Say so on the task, so it doesn't sit in In progress.
        await api.finishBuild(job.task.id, `The runner hit a problem on branch ${branch} and stopped: ${err.message}`).catch(() => {});
        await record({ config, api, job, startedAt, entry: { result: 'runner error', branch, error: err.message } });
        throw err;
    }
    finally
    {
        await removeWorktree(project, worktree);
    }
}

// Today's cap for each step (API mode): the step's own cap, or what's left of the day's. null = used up.
function todaysBudgets(config)
{
    const caps = { refine: config.steps.refine.maxBudgetUsd, build: config.steps.build.maxBudgetUsd };
    if (config.auth !== 'api') return caps; // on the Pro plan the usage limit does this job
    const spent = spentToday(config.logFile);
    if (config.dailyCapUsd - spent < MIN_STEP_BUDGET_USD)
    {
        say(`Today's spend cap is used up (${dollars(spent)} of ${dollars(config.dailyCapUsd)}). Waiting until tomorrow.`);
        return null;
    }
    return {
        refine: stepBudget(caps.refine, config.dailyCapUsd, spent),
        build: stepBudget(caps.build, config.dailyCapUsd, spent),
    };
}

async function main()
{
    if (process.argv[2] !== 'once')
    {
        console.log('Usage: pnpm once   (does one step for one task, then stops)');
        process.exitCode = 1;
        return;
    }

    const config = loadConfig();
    const until = pausedUntil(config.pauseFile);
    if (until)
    {
        say(`Paused until ${until.toLocaleString()} (usage limit). Nothing to do before then.`);
        return;
    }

    await preflight(config);
    const api = createApi(config.taskBoardUrl, process.env.RUNNER_TOKEN.trim());
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
        say('Another runner is already working. Stopping.');
        return;
    }
    try
    {
        const budgets = todaysBudgets(config);
        if (!budgets) return;

        const job = await api.nextJob();
        if (!job)
        {
            say('Nothing to do.');
            return;
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
            await record({ config, api, job, startedAt, entry: { result: 'stopped', error: message } });
            return;
        }

        if (job.kind === 'BUILD') await doBuild({ job, project, config: runConfig, api, startedAt });
        else await doRefine({ job, project, config: runConfig, api, startedAt });
    }
    finally
    {
        releaseLock(config.lockFile);
    }
}

main().catch((err) => {
    console.error(`[runner] ${err.message}`);
    process.exitCode = 1;
});
