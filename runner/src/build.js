// Step 2: carry out the approved prompt on a new branch, check the build and tests, commit, summarise.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { between, runClaude } from './claude.js';
import { git, projectCommand, sandboxedCommand, tail } from './shell.js';
import { sandboxDenyRead } from './claude.js';
import { findSecrets } from './secrets.js';
import { addPackageJson, removePlaceholders } from './placeholders.js';

// "Add a search box!" -> "add-a-search-box" (at most 5 words)
export function slug(title)
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

// A read-only look at main for the prompt step: a temporary worktree on main (no branch), so Claude reads
// the same code the build will start from, whatever you have checked out in the project folder right now.
export async function prepareMainCopy({ job, project, projectName, config })
{
    const copy = join(config.worktreeRoot, projectName, `task-${job.task.id}-prompt`);
    if (existsSync(copy)) await git(project.path, ['worktree', 'remove', '--force', copy]); // left from a crashed run
    await git(project.path, ['worktree', 'add', '--detach', copy, project.baseBranch]);
    return copy;
}

export async function removeWorktree(project, worktree)
{
    // The branch stays (that's the work); only the extra folder goes
    await git(project.path, ['worktree', 'remove', '--force', worktree]).catch(() => {});
}

// knownSecrets: exact values that must never end up in a commit (the runner's own key and token)
export async function build({ job, project, config, branch, worktree, knownSecrets = [] })
{
    const timeoutMs = 10 * 60 * 1000;

    // 1. Setup the runner does itself (e.g. installing packages), never Claude. It runs on a fresh copy
    //    of main, before Claude has changed anything, so it's your own code (and it may need the internet).
    for (const command of project.setup)
    {
        const result = await projectCommand(command, worktree, timeoutMs);
        if (result.code !== 0) return { setupFailed: `"${command}" failed:\n${tail(result.stderr || result.stdout)}` };
    }

    // 2. Claude carries out the approved prompt: edit files, and run only the build and test commands.
    //    Then the empty files Claude Code leaves behind go, so they're neither checked nor committed.
    addPackageJson(worktree);
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
        allowedCommands: [project.build, project.test],
    });
    await removePlaceholders(worktree);

    // 3. The runner checks the result itself, instead of trusting Claude's word for it. These run code
    //    Claude just wrote, so they run sandboxed: no network, no secrets, only the worktree writable.
    const hidden = sandboxDenyRead();
    const buildResult = await sandboxedCommand(project.build, worktree, timeoutMs, hidden);
    const testResult = await sandboxedCommand(project.test, worktree, timeoutMs, hidden);

    // 4. The secret scan: nothing that looks like a secret is ever committed. If it finds one, the
    //    changes are thrown away (the worktree is deleted afterwards) and the branch stays empty.
    await git(worktree, ['add', '-A']);
    const secretsFound = findSecrets(await git(worktree, ['diff', '--cached']), knownSecrets);
    if (secretsFound.length) return { outcome, buildResult, testResult, secretsFound };

    // 5. Commit whatever changed, on the task's branch only
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
export function summaryComment({ project, branch, result, auth = 'api' })
{
    const { outcome, buildResult, testResult, changedFiles, summary, secretsFound } = result;
    if (secretsFound?.length)
    {
        return [
            'Blocked: the changes contained something that looks like a secret, so nothing was committed '
                + 'and the changes were thrown away.',
            ...secretsFound.map((found) => `- ${found.file}: ${found.kind}`),
            '',
            `The branch ${branch} is left empty. Check the prompt, then use "Try again" or create a new task.`,
        ].join('\n');
    }
    const checksPassed = buildResult.code === 0 && testResult.code === 0;
    const lines = [];

    if (!outcome.ok) lines.push(`Claude stopped before finishing: ${outcome.error}. Whatever it did is on the branch.`);
    else if (!checksPassed) lines.push('Done, but the checks FAILED: see below before you merge anything.');
    else lines.push('Done: the build and tests passed.');

    lines.push('', `Branch: ${branch}`, `Build (${project.build}): ${passedOrFailed(buildResult)}`, `Tests (${project.test}): ${passedOrFailed(testResult)}`);
    if (outcome.costUsd !== null)
    {
        lines.push(auth === 'pro'
            ? `Usage of this run: about $${outcome.costUsd.toFixed(2)} worth, counted toward your Pro plan's limit`
            : `Cost of this run: $${outcome.costUsd.toFixed(2)}`);
    }

    lines.push('', 'What changed:', summary ?? '(Claude gave no summary.)');
    lines.push('', 'Files:', changedFiles || '(no files changed)');

    if (buildResult.code !== 0) lines.push('', 'Build output (last lines):', tail(buildResult.stdout + buildResult.stderr));
    if (testResult.code !== 0) lines.push('', 'Test output (last lines):', tail(testResult.stdout + testResult.stderr));

    lines.push('', 'To try it:', `cd ${project.path}`, `git switch ${branch}`);
    return lines.join('\n');
}
