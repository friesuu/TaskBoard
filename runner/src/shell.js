// Running programs: git (with exact arguments) and the project's own build / test / setup commands.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

// Runs a program and collects its output. Never throws: check `code` (0 = success).
export function run(command, args, { cwd, env = process.env, input, timeoutMs = 10 * 60 * 1000 } = {})
{
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (err) => { stderr += err.message; }); // e.g. the program doesn't exist
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: timedOut ? null : code, stdout, stderr, timedOut });
        });
        // A program that exits before reading its input (e.g. it refused its options) closes the pipe:
        // that's reported through its exit code and output above, not a reason to crash the runner
        child.stdin.on('error', () => {});
        child.stdin.end(input ?? '');
    });
}

// git with exact arguments (no shell, so nothing in a branch name or title can turn into a command)
export async function git(cwd, args)
{
    const result = await run('git', args, { cwd });
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
    return result.stdout.trim();
}

// One of the project's commands from projects.json (e.g. "npm test"). These come from your own
// config file, never from a task, so running them through the shell is safe.
// The runner token is left out of their environment.
export function projectCommand(command, cwd, timeoutMs)
{
    const env = { ...process.env };
    delete env.RUNNER_TOKEN;
    return run('sh', ['-c', command], { cwd, env, timeoutMs });
}

// One of the project's checks (build, test) on code Claude just wrote, so it gets the same locks as Claude:
// run inside bwrap (the tool Claude Code's own sandbox uses) with no network, every secret file or folder
// masked, the whole system read-only except the task's own folder, and no keys in its environment.
// If bwrap is missing, the check doesn't run at all (it never runs unprotected).
export function sandboxedCommand(command, cwd, timeoutMs, hiddenPaths)
{
    const env = { ...process.env };
    delete env.RUNNER_TOKEN;
    delete env.ANTHROPIC_API_KEY;

    const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp'];
    for (const path of hiddenPaths)
    {
        if (!existsSync(path)) continue;
        if (statSync(path).isDirectory()) args.push('--tmpfs', path); // an empty folder in its place
        else args.push('--ro-bind', '/dev/null', path); // an empty file in its place
    }
    args.push(
        '--bind', cwd, cwd, // the task's folder: the only place it can write
        '--unshare-net', // no network at all
        '--unshare-pid', '--die-with-parent', '--new-session',
        '--chdir', cwd,
        'sh', '-c', command,
    );
    return run('bwrap', args, { cwd, env, timeoutMs });
}

// The last lines of a long output (for a task comment)
export function tail(text, lines = 30)
{
    return text.trim().split('\n').slice(-lines).join('\n');
}
