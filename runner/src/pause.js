// Pro plan only: when Claude Code says "You've hit your session limit · resets 3:45pm", the runner
// writes the reset time to a small file and does nothing until then. It never pushes against the limit.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "3:45pm", "3pm", "15:45", "Mon 12:00am" -> the next moment that matches, after `now` (local time).
// Anything it can't read: one hour from now, so the runner still backs off.
export function parseReset(text, now = new Date())
{
    const match = String(text).match(/(?:\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return new Date(now.getTime() + 60 * 60 * 1000);

    const [, day, hourText, minuteText, meridiem] = match;
    let hours = Number(hourText);
    const minutes = Number(minuteText ?? 0);
    if (meridiem) hours = (hours % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
    if (hours > 23 || minutes > 59) return new Date(now.getTime() + 60 * 60 * 1000);

    const reset = new Date(now);
    reset.setHours(hours, minutes, 0, 0);
    if (day)
    {
        const wanted = DAYS.indexOf(day.toLowerCase());
        while (reset.getDay() !== wanted || reset <= now) reset.setDate(reset.getDate() + 1);
    }
    else if (reset <= now)
    {
        reset.setDate(reset.getDate() + 1);
    }
    return reset;
}

// The time the runner is paused until, or null (a pause that has ended is removed)
export function pausedUntil(pauseFile, now = new Date())
{
    if (!existsSync(pauseFile)) return null;
    try
    {
        const until = new Date(JSON.parse(readFileSync(pauseFile, 'utf8')).until);
        if (until > now) return until;
    }
    catch { /* unreadable: treat as no pause */ }
    unlinkSync(pauseFile);
    return null;
}

export function pause(pauseFile, until, reason)
{
    mkdirSync(dirname(pauseFile), { recursive: true });
    writeFileSync(pauseFile, JSON.stringify({ until: until.toISOString(), reason }));
}
