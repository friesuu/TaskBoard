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
