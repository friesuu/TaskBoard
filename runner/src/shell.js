// Running programs: git (with exact arguments) and the project's own build / test / setup commands.
import { spawn } from 'node:child_process';

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

// The last lines of a long output (for a task comment)
export function tail(text, lines = 30)
{
    return text.trim().split('\n').slice(-lines).join('\n');
}
