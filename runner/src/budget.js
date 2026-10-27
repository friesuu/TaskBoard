// The daily spend cap (API mode): adds up today's costs from logs/runs.log, and gives each step
// whatever is left of today's cap (never more than the step's own cap).
import { existsSync, readFileSync } from 'node:fs';

// Below this, a step isn't worth starting: wait until tomorrow
export const MIN_STEP_BUDGET_USD = 0.05;

const localDate = (date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

// Dollars spent today (your local day), from the log file. Unreadable lines are skipped.
export function spentToday(logFile, now = new Date())
{
    if (!existsSync(logFile)) return 0;
    const today = localDate(now);
    let total = 0;
    for (const line of readFileSync(logFile, 'utf8').split('\n'))
    {
        if (!line.trim()) continue;
        try
        {
            const entry = JSON.parse(line);
            if (localDate(new Date(entry.time)) === today && typeof entry.costUsd === 'number') total += entry.costUsd;
        }
        catch { /* not a log line */ }
    }
    return total;
}

// The cap for one step today: its own cap, or what's left of the day's, whichever is smaller
export function stepBudget(stepCapUsd, dailyCapUsd, spentUsd)
{
    return Math.max(0, Math.min(stepCapUsd, dailyCapUsd - spentUsd));
}
