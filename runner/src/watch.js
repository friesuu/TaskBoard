// Watch mode (`pnpm watch`): does the next waiting step as soon as there is one, checking every 30 seconds,
// until you stop it. Still one step at a time, and with every lock and limit of `pnpm once`.
//   Ctrl+C once:  stop after the step that's running (a build is never cut off halfway)
//   Ctrl+C twice: stop straight away

export const CHECK_EVERY_MS = 30 * 1000;
const CAPPED_RECHECK_MS = 10 * 60 * 1000;
const PAUSED_RECHECK_MAX_MS = 5 * 60 * 1000;

// How long to wait before the next check, after a step that ended with `result.status`
export function nextCheckDelay(result, now = new Date())
{
    switch (result.status)
    {
        case 'done': return 0; // something else may be waiting: check again straight away
        case 'paused': return Math.max(1000, Math.min(result.until - now, PAUSED_RECHECK_MAX_MS));
        case 'capped': return CAPPED_RECHECK_MS;
        default: return CHECK_EVERY_MS; // nothing waiting, another runner busy, or an error
    }
}

// What to say when the state changes (null = say nothing). Watch mode is quiet while nothing changes.
export function statusMessage(result)
{
    switch (result.status)
    {
        case 'idle': return 'Waiting for AI tasks…';
        case 'capped': return "Today's spend cap is used up: checking again every 10 minutes.";
        case 'paused': return `Paused until ${result.until.toLocaleString()} (usage limit).`;
        case 'busy': return 'Another runner is working (the schedule?): waiting for it.';
        case 'error': return `Problem: ${result.error}. Trying again in 30 seconds.`;
        default: return null;
    }
}

// runStep(): does at most one step and returns { status: 'done' | 'idle' | 'paused' | 'capped' | 'busy' }.
// stopChildren(): stops whatever the step is running (for the second Ctrl+C).
export async function watch({ runStep, stopChildren, say })
{
    let stopping = false;
    let inStep = false;
    let lastMessage = null;

    process.on('SIGINT', () => {
        if (!inStep || stopping)
        {
            if (inStep) stopChildren();
            say(inStep ? 'Stopped straight away. That task may need "Try again".' : 'Stopped.');
            process.exit(130);
        }
        stopping = true;
        say('Stopping after this step. Press Ctrl+C again to stop straight away.');
    });

    say('Watching for AI tasks (checks every 30 seconds). Press Ctrl+C to stop.');
    while (!stopping)
    {
        let result;
        inStep = true;
        try
        {
            result = await runStep();
        }
        catch (err)
        {
            result = { status: 'error', error: err.message };
        }
        inStep = false;
        if (stopping) break;

        const message = statusMessage(result);
        if (message && message !== lastMessage) say(message);
        lastMessage = result.status === 'done' ? null : message;

        await new Promise((resolve) => setTimeout(resolve, nextCheckDelay(result)));
    }
    say('Stopped.');
}
