import { todayString } from './dates';

// Month-grid date maths. Dates are 'YYYY-MM-DD' strings (like due dates); the maths is done on
// midnight-UTC Date objects, so the browser's time zone and daylight saving can never shift a day.

const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = (dateString) => new Date(`${dateString}T00:00:00Z`);
const toDateString = (date) => date.toISOString().slice(0, 10);

// The month that holds today: { year: 2026, month: 10 } (month 1-12)
export function currentMonth()
{
    const [year, month] = todayString().split('-').map(Number);
    return { year, month };
}

// One month earlier (delta -1) or later (+1), across year ends too
export function shiftMonth({ year, month }, delta)
{
    const index = year * 12 + (month - 1) + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// "October 2026", in the viewer's own language
export function monthLabel({ year, month })
{
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(Date.UTC(year, month - 1, 1));
}

// "Mon", "Tue" ... "Sun" (weeks start on Monday, like the "this week" filter)
export function weekdayLabels()
{
    const monday = Date.UTC(2024, 0, 1); // 1 Jan 2024 was a Monday
    return Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(monday + i * DAY_MS));
}

// The weeks to show for a month: Monday to Sunday, from the week of the 1st to the week of the last day.
// Each day: { date: 'YYYY-MM-DD', day: 28, inMonth: false }
export function monthGrid({ year, month })
{
    const first = new Date(Date.UTC(year, month - 1, 1));
    const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this one
    const start = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS); // back to Monday
    const end = new Date(last.getTime() + ((7 - last.getUTCDay()) % 7) * DAY_MS);    // on to Sunday

    const weeks = [];
    for (let day = start; day <= end; day = new Date(day.getTime() + DAY_MS))
    {
        if (weeks.length === 0 || weeks.at(-1).length === 7) weeks.push([]);
        weeks.at(-1).push({ date: toDateString(day), day: day.getUTCDate(), inMonth: day.getUTCMonth() === month - 1 });
    }
    return weeks;
}

// The month a date is in (so "jump to the month of this task" is easy)
export function monthOf(dateString)
{
    const date = toDate(dateString);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

// The droppable id of the "No due date" list (every other drop target is a 'YYYY-MM-DD' day)
export const NO_DATE = 'no-date';

// What a finished drag means: { taskId, dueDate } to save (dueDate null = no date), or null for "nothing changed"
export function dueDateFromDrop({ draggableId, destination }, tasks)
{
    if (!destination) return null; // dropped outside the calendar, or Esc pressed
    const taskId = Number(draggableId);
    const dueDate = destination.droppableId === NO_DATE ? null : destination.droppableId;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || (task.dueDate ?? null) === dueDate) return null; // same day as before
    return { taskId, dueDate };
}
