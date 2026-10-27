// The Claude runner's part of a task, as the app shows it: the card's chip, the AI tab's progress steps,
// and how runs and notifications are worded. Plain functions, no React, so they're easy to test.

// Tasks with a label called "AI" (any capitals) are the ones the Claude runner works on
export const isAiTask = (task) => task.labels?.some((l) => l.name.toLowerCase() === 'ai') ?? false;

// Claude has done, or will do, something on this task: it gets an AI tab
export const hasAiWork = (task) => isAiTask(task) || Boolean(task.refinedPrompt || task.aiBranch || task.aiError);

// The five states. tone = the status colour (always shown with its words, never colour alone);
// live = it's something the runner does, so its dot pulses while the runner is on this task.
export const AI_STATES = {
    refining: { label: 'Refining prompt', tone: 'prompt', live: true },
    approval: { label: 'Needs your approval', tone: 'prompt', live: false },
    working: { label: 'Working', tone: 'ai', live: true },
    review: { label: 'Ready for review', tone: 'success', live: false },
    failed: { label: 'Failed', tone: 'danger', live: false },
};

// Which of the five a task is in, or null (not an AI task, done, or nothing for Claude to do)
export function aiStateOf(task)
{
    if (!hasAiWork(task) || task.status === 'DONE') return null;
    if (task.aiError) return 'failed';
    switch (task.status)
    {
        case 'TODO': return isAiTask(task) && !task.refinedPrompt ? 'refining' : null;
        case 'PROMPT_REVIEW': return task.changesRequested ? 'refining' : (task.refinedPrompt ? 'approval' : null);
        case 'IN_PROGRESS': return task.promptApprovedAt ? 'working' : null;
        case 'AI_REVIEW': return task.aiChecksPassed === false ? 'failed' : 'review';
        default: return null;
    }
}

// The AI tab's progress: Refine → Approve → Work → Review. aiStepOf = the step it's on (0 to 3).
export const AI_STEPS = ['Refine', 'Approve', 'Work', 'Review'];

export function aiStepOf(task)
{
    switch (task.status)
    {
        case 'PROMPT_REVIEW': return task.changesRequested ? 0 : 1;
        case 'IN_PROGRESS': return 2;
        case 'AI_REVIEW':
        case 'DONE': return 3;
        default: return 0;
    }
}

// ----- Runs -----

export const STEP_NAMES = { refine: 'Writing the prompt', build: 'Building' };

// "1m 22s". A run still going counts up to now.
export function durationOf(run, now = new Date())
{
    const end = run.finishedAt ? new Date(run.finishedAt) : now;
    const seconds = Math.max(0, Math.round((end - new Date(run.startedAt)) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

// A run's outcome in a few words: "Running", "Built · checks passed", "Stopped · checks failed"
export function runResultText(run)
{
    if (run.status === 'running') return 'Running';
    const result = run.result.charAt(0).toUpperCase() + run.result.slice(1);
    if (run.checksPassed === true) return `${result} · checks passed`;
    if (run.checksPassed === false) return `${result} · checks failed`;
    return result;
}

// The tone of a run's result: running (teal, pulsing), succeeded (mint) or failed (red)
export const RUN_TONES = { running: 'ai', succeeded: 'success', failed: 'danger' };

// ----- Notifications -----

export const NOTIFICATION_TONES = { prompt_ready: 'prompt', review_ready: 'success', run_failed: 'danger', usage_limit: 'warning' };

// "just now", "5 min ago", "2 h ago", "3 days ago"
export function timeAgo(isoString, now = new Date())
{
    const seconds = Math.max(0, Math.round((now - new Date(isoString)) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}
