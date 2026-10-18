export function todayString()
{
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

export function isOverdue(task)
{
    return task.dueDate !== null && task.status !== 'DONE' && task.dueDate < todayString();
}

// "16 Oct 2026, 2:30 pm" (in the viewer's own language and time zone), for comment times
export function formatDateTime(isoString)
{
    return new Date(isoString).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// A due date said the friendly way: "Today", "Tomorrow", "Yesterday", "2 Oct",
// or "2 Oct 2027" when it isn't this year. dateString is 'YYYY-MM-DD'.
export function formatDueDate(dateString)
{
    const DAY_MS = 24 * 60 * 60 * 1000;
    const daysFromToday = Math.round(
        (Date.parse(`${dateString}T00:00:00Z`) - Date.parse(`${todayString()}T00:00:00Z`)) / DAY_MS,
    );
    if (daysFromToday === 0) return 'Today';
    if (daysFromToday === 1) return 'Tomorrow';
    if (daysFromToday === -1) return 'Yesterday';

    const sameYear = dateString.slice(0, 4) === todayString().slice(0, 4);
    // en-GB puts the day first ("2 Oct"); timeZone UTC so the date can't shift to the day before or after
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: sameYear ? undefined : 'numeric',
        timeZone: 'UTC',
    }).format(Date.parse(`${dateString}T00:00:00Z`));
}
