// Step 2: carry out the approved prompt on a new branch, check the build and tests, commit, summarise.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { between, runClaude } from './claude.js';
import { git, projectCommand, tail } from './shell.js';

// "Add a search box!" -> "add-a-search-box" (at most 5 words)
function slug(title)
{
    return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 5).join('-') || 'task';
}

// ai/task-12-add-search, or ai/task-12-add-search-2 if that name is taken
async function freeBranchName(repo, base)
{
    for (let n = 1; ; n++)
    {
        const name = n === 1 ? base : `${base}-${n}`;
        const exists = await git(repo, ['branch', '--list', name]);
        if (!exists) return name;
    }
}

// Things to check before touching anything. Returns an error message, or null when all is well.
export async function checkProject(project)
{
    if (!existsSync(project.path)) return `The project folder ${project.path} doesn't exist`;
    try
    {
        await git(project.path, ['rev-parse', '--verify', `${project.baseBranch}^{commit}`]);
    }
    catch
    {
        return `${project.path} isn't a git repository with a "${project.baseBranch}" branch`;
    }
    return null;
}

// The worktree: a separate folder with its own copy of the project on the new branch.
// Your own project folder (and whatever you have open in it) is never touched.
export async function prepareWorktree({ job, project, projectName, config })
{
    const branch = await freeBranchName(project.path, `ai/task-${job.task.id}-${slug(job.task.title)}`);
    const worktree = join(config.worktreeRoot, projectName, `task-${job.task.id}`);
    if (existsSync(worktree)) await git(project.path, ['worktree', 'remove', '--force', worktree]); // left from a crashed run
    await git(project.path, ['worktree', 'add', '-b', branch, worktree, project.baseBranch]);
    return { branch, worktree };
}

export async function removeWorktree(project, worktree)
{
    // The branch stays (that's the work); only the extra folder goes
    await git(project.path, ['worktree', 'remove', '--force', worktree]).catch(() => {});
}

export async function build({ job, project, config, branch, worktree })
{
    const timeoutMs = 10 * 60 * 1000;

    // 1. Setup the runner does itself (e.g. installing packages), never Claude
    for (const command of project.setup)
    {
        const result = await projectCommand(command, worktree, timeoutMs);
        if (result.code !== 0) return { setupFailed: `"${command}" failed:\n${tail(result.stderr || result.stdout)}` };
    }

    // 2. Claude carries out the approved prompt: edit files, and run only the build and test commands
    const outcome = await runClaude({
        config,
        step: config.steps.build,
        cwd: worktree,
        prompt: [
            `Carry out this approved prompt in your working directory, a git worktree on branch ${branch}.`,
            `<approved_prompt>\n${job.approvedPrompt}\n</approved_prompt>`,
            `You can run "${project.build}" and "${project.test}". Finish with your summary between <summary> and </summary>.`,
        ].join('\n\n'),
        systemPrompt: config.rules.build,
        tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
        allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', `Bash(${project.build})`, `Bash(${project.test})`],
    });

    // 3. The runner checks the result itself, instead of trusting Claude's word for it
    const buildResult = await projectCommand(project.build, worktree, timeoutMs);
    const testResult = await projectCommand(project.test, worktree, timeoutMs);

    // 4. Commit whatever changed, on the task's branch only
    await git(worktree, ['add', '-A']);
    const changedFiles = await git(worktree, ['diff', '--cached', '--name-status']);
    if (changedFiles)
    {
        await git(worktree, [
            '-c', 'user.name=Claude (task runner)', '-c', 'user.email=runner@task-board.local',
            'commit', '-m', `${job.task.title} (task #${job.task.id})\n\nBuilt by the Claude runner from the approved prompt.`,
        ]);
    }

    return { outcome, buildResult, testResult, changedFiles, summary: outcome.ok ? between(outcome.text, 'summary') : null };
}

const passedOrFailed = (result) => (result.code === 0 ? 'passed' : result.timedOut ? 'timed out' : 'FAILED');

// The comment posted on the task when the build finishes
export function summaryComment({ project, branch, result })
{
    const { outcome, buildResult, testResult, changedFiles, summary } = result;
    const checksPassed = buildResult.code === 0 && testResult.code === 0;
    const lines = [];

    if (!outcome.ok) lines.push(`Claude stopped before finishing: ${outcome.error}. Whatever it did is on the branch.`);
    else if (!checksPassed) lines.push('Done, but the checks FAILED: see below before you merge anything.');
    else lines.push('Done: the build and tests passed.');

    lines.push('', `Branch: ${branch}`, `Build (${project.build}): ${passedOrFailed(buildResult)}`, `Tests (${project.test}): ${passedOrFailed(testResult)}`);
    if (outcome.costUsd !== null) lines.push(`Cost of this run: $${outcome.costUsd.toFixed(2)}`);

    lines.push('', 'What changed:', summary ?? '(Claude gave no summary.)');
    lines.push('', 'Files:', changedFiles || '(no files changed)');

    if (buildResult.code !== 0) lines.push('', 'Build output (last lines):', tail(buildResult.stdout + buildResult.stderr));
    if (testResult.code !== 0) lines.push('', 'Test output (last lines):', tail(testResult.stdout + testResult.stderr));

    lines.push('', 'To try it:', `cd ${project.path}`, `git switch ${branch}`);
    return lines.join('\n');
}
