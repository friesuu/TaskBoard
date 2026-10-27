// Loads config.json and projects.json, and checks them before anything runs.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The runner's own folder (runner/), so it works whichever folder you start it from
export const RUNNER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// "~/x" -> "/home/you/x"; "./x" -> relative to the runner folder
export function expandPath(path)
{
    if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1));
    return isAbsolute(path) ? path : resolve(RUNNER_DIR, path);
}

const readJson = (name) => JSON.parse(readFileSync(join(RUNNER_DIR, name), 'utf8'));

export function loadConfig()
{
    const config = readJson('config.json');
    if (config.auth !== 'api' && config.auth !== 'pro') throw new Error('config.json: "auth" must be "api" or "pro"');
    if (typeof config.dailyCapUsd !== 'number' || config.dailyCapUsd < 0) throw new Error('config.json: "dailyCapUsd" must be a number of dollars');

    // Every project's folder is fixed here, never taken from a task: a task can only name a project
    const projects = readJson('projects.json');
    for (const [name, project] of Object.entries(projects))
    {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`projects.json: "${name}" isn't a valid project name`);
        for (const key of ['path', 'baseBranch', 'build', 'test'])
        {
            if (typeof project[key] !== 'string' || !project[key]) throw new Error(`projects.json: "${name}" needs "${key}"`);
        }
        project.path = expandPath(project.path);
        project.setup ??= [];
    }

    return {
        ...config,
        claudePath: expandPath(config.claudePath),
        worktreeRoot: expandPath(config.worktreeRoot),
        lockFile: expandPath(config.lockFile),
        pauseFile: expandPath(config.pauseFile),
        logFile: expandPath(config.logFile),
        guardLogFile: expandPath(config.guardLogFile),
        projects,
        promptStyle: readFileSync(join(RUNNER_DIR, 'PROMPT_STYLE.md'), 'utf8'),
        rules: {
            refine: readFileSync(join(RUNNER_DIR, 'rules/refine.md'), 'utf8'),
            build: readFileSync(join(RUNNER_DIR, 'rules/build.md'), 'utf8'),
        },
    };
}
