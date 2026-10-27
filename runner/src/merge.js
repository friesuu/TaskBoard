// Step 3, after your review: merge a built branch you clicked Merge on. No Claude: only git, run by the runner.
//   1. the task's branch into the project's base branch (main)
//   2. then main into each branch in the project's "alsoMergeInto" (e.g. runner-pro)
// It stops, changing nothing, when the branch touches a protected path (e.g. the runner's own code: that
// always gets merged by hand), and it never leaves a half-done merge behind: a conflict is undone at once.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, run } from './shell.js';

const RUNNER_IDENTITY = ['-c', 'user.name=Claude (task runner)', '-c', 'user.email=runner@task-board.local'];

// A problem the runner explains to you on the task (as opposed to the runner itself breaking)
export class MergeRefused extends Error {}

// The files a branch changes, compared with where it started from main
export async function changedFiles(repo, base, branch)
{
    const out = await git(repo, ['diff', '--name-only', `${base}...${branch}`]);
    return out ? out.split('\n') : [];
}

// "runner/" protects everything in that folder; "package.json" only that file
export function protectedFiles(files, protectedPaths)
{
    return files.filter((file) => protectedPaths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p)));
}

// Where each branch is checked out: { 'runner-pro': '/home/you/task-board', ... }
async function checkedOut(repo)
{
    const where = {};
    let folder = null;
    for (const line of (await git(repo, ['worktree', 'list', '--porcelain'])).split('\n'))
    {
        if (line.startsWith('worktree ')) folder = line.slice('worktree '.length);
        if (line.startsWith('branch refs/heads/')) where[line.slice('branch refs/heads/'.length)] = folder;
    }
    return where;
}

// Merges `source` into `target`. If `target` is checked out somewhere (e.g. your project folder), the merge
// happens there, so your files update, but only if nothing in it is uncommitted. Otherwise it happens in a
// temporary folder that's removed afterwards.
async function mergeInto({ project, config, projectName, target, source, message, log })
{
    const folder = (await checkedOut(project.path))[target];
    if (folder)
    {
        const dirty = await git(folder, ['status', '--porcelain', '--untracked-files=no']);
        if (dirty)
        {
            throw new MergeRefused(`${target} has uncommitted changes in ${folder}. Commit or stash them, then click "Try again".`);
        }
        await mergeIn(folder, target, source, message, log);
        return;
    }

    const temp = join(config.worktreeRoot, projectName, `merge-${target.replace(/[^a-zA-Z0-9-]/g, '-')}`);
    if (existsSync(temp)) await git(project.path, ['worktree', 'remove', '--force', temp]); // left from a crashed run
    await git(project.path, ['worktree', 'add', temp, target]);
    try
    {
        await mergeIn(temp, target, source, message, log);
    }
    finally
    {
        await git(project.path, ['worktree', 'remove', '--force', temp]).catch(() => {});
    }
}

async function mergeIn(folder, target, source, message, log)
{
    const result = await run('git', [...RUNNER_IDENTITY, 'merge', '--no-edit', '-m', message, source], { cwd: folder });
    if (result.code !== 0)
    {
        await run('git', ['merge', '--abort'], { cwd: folder }); // back to how it was: never half-merged
        throw new MergeRefused(`Merging ${source} into ${target} has conflicts, so nothing was changed there. Merge it by hand.`);
    }
    log.add('info', result.stdout.includes('Already up to date') ? `${target} already has ${source}` : `Merged ${source} into ${target}`);
}

// Returns { merged: [branches] }. Throws MergeRefused (with what to do) when it stops on purpose.
export async function merge({ job, project, projectName, config, log })
{
    const branch = job.task.aiBranch;
    // The board names the branch; it must still be this task's own branch, and exist
    if (!branch || !new RegExp(`^ai/task-${job.task.id}(-[a-z0-9]+)*$`).test(branch))
    {
        throw new MergeRefused(`"${branch}" isn't this task's branch`);
    }
    if ((await run('git', ['rev-parse', '--verify', `refs/heads/${branch}`], { cwd: project.path })).code !== 0)
    {
        throw new MergeRefused(`The branch ${branch} doesn't exist any more`);
    }

    const files = await changedFiles(project.path, project.baseBranch, branch);
    log.add('info', `${branch} changes ${files.length} file(s): ${files.join(', ') || 'none'}`);
    const blocked = protectedFiles(files, project.protectedPaths);
    if (blocked.length)
    {
        throw new MergeRefused(`It changes ${blocked.join(', ')}, which the runner never merges by itself. `
            + `Check it, then merge it by hand: git merge ${branch}`);
    }

    const merged = [];
    await mergeInto({
        project, config, projectName, target: project.baseBranch, source: branch, log,
        message: `Merge ${branch} (task #${job.task.id}), after your review`,
    });
    merged.push(project.baseBranch);
    for (const target of project.alsoMergeInto)
    {
        await mergeInto({
            project, config, projectName, target, source: project.baseBranch, log,
            message: `Merge ${project.baseBranch} into ${target} (task #${job.task.id})`,
        });
        merged.push(target);
    }
    return { merged };
}
