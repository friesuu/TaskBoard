// The Claude runner: `pnpm once` does ONE step for ONE task, then stops.
//   - a task you approved          -> build it on a new branch, check it, commit, summarise -> AI Review
//   - otherwise, an "AI" task that needs a prompt (new, or you asked for changes) -> write it -> Prompt Review
// Everything about which task and which step is decided by the task board, not here.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.js';
import { createApi } from './api.js';
import { run } from './shell.js';
import { releaseLock, takeLock } from './lock.js';
import { refine } from './refine.js';
import { build, checkProject, prepareWorktree, removeWorktree, summaryComment } from './build.js';

const say = (message) => console.log(`[runner] ${message}`);

// One line per run in logs/runs.log: when, which task, which step, the result, what it cost
function logRun(config, entry)
{
    mkdirSync(dirname(config.logFile), { recursive: true });
    appendFileSync(config.logFile, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
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
}

async function doRefine({ job, project, config, api })
{
    const result = await refine({ job, project, config });
    const entry = { taskId: job.task.id, step: 'refine', project: job.project, costUsd: result.costUsd };

    if (result.usageLimit) // Pro plan only: leave the task alone and try again after the reset
    {
        say(`Usage limit reached (resets ${result.usageLimit.resets}). The task is left as it is.`);
        logRun(config, { ...entry, result: 'usage limit', resets: result.usageLimit.resets });
        return;
    }
    if (result.refined)
    {
        await api.savePrompt(job.task.id, result.refined);
        say('Prompt saved: the task is in Prompt Review.');
        logRun(config, { ...entry, result: 'prompt saved' });
    }
    else
    {
        await api.reportError(job.task.id, result.error);
        say(`Stopped: ${result.error}`);
        logRun(config, { ...entry, result: 'stopped', error: result.error });
    }
}

async function doBuild({ job, project, config, api })
{
    const entry = { taskId: job.task.id, step: 'build', project: job.project };
    const problem = await checkProject(project);
    if (problem)
    {
        await api.reportError(job.task.id, problem);
        say(`Stopped: ${problem}`);
        logRun(config, { ...entry, result: 'stopped', error: problem });
        return;
    }

    const { branch, worktree } = await prepareWorktree({ job, project, projectName: job.project, config });
    try
    {
        await api.startBuild(job.task.id, branch); // marks the task, so it's never built twice
        say(`Working on branch ${branch}`);

        const result = await build({ job, project, config, branch, worktree });
        const summary = result.setupFailed
            ? `I couldn't set up the project on branch ${branch}: ${result.setupFailed}`
            : summaryComment({ project, branch, result });
        await api.finishBuild(job.task.id, summary);

        const checks = result.setupFailed ? null : { build: result.buildResult.code === 0, tests: result.testResult.code === 0 };
        say(`Done: the task is in AI Review.${checks && !(checks.build && checks.tests) ? ' The checks failed: see the task.' : ''}`);
        logRun(config, {
            ...entry, branch, result: result.setupFailed ? 'setup failed' : result.outcome.ok ? 'built' : 'stopped early',
            checks, costUsd: result.outcome?.costUsd ?? null, error: result.outcome?.error ?? result.setupFailed ?? null,
        });
    }
    catch (err)
    {
        // The runner itself failed part-way (e.g. git). Say so on the task, so it doesn't sit in In progress.
        await api.finishBuild(job.task.id, `The runner hit a problem on branch ${branch} and stopped: ${err.message}`).catch(() => {});
        logRun(config, { ...entry, branch, result: 'runner error', error: err.message });
        throw err;
    }
    finally
    {
        await removeWorktree(project, worktree);
    }
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
        const job = await api.nextJob();
        if (!job)
        {
            say('Nothing to do.');
            return;
        }
        say(`${job.kind === 'BUILD' ? 'Building' : 'Writing a prompt for'} task #${job.task.id} "${job.task.title}" (project ${job.project})`);

        const project = config.projects[job.project];
        if (!project)
        {
            const message = `The project "${job.project}" isn't in the runner's projects.json`;
            await api.reportError(job.task.id, message);
            say(`Stopped: ${message}`);
            logRun(config, { taskId: job.task.id, step: job.kind.toLowerCase(), project: job.project, result: 'stopped', error: message });
            return;
        }

        if (job.kind === 'BUILD') await doBuild({ job, project, config, api });
        else await doRefine({ job, project, config, api });
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
