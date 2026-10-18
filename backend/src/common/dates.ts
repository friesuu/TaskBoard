// "Today" and "this week" as calendar dates (YYYY-MM-DD) in a given time zone.
// Due dates are plain dates, so comparing these strings is enough: '2026-10-05' < '2026-10-18'.

// Today's date where the user is, e.g. '2026-10-18'. No time zone (not sent yet) = UTC.
export function todayIn(timeZone: string | null): string {
  // en-CA formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// This week, Monday to Sunday, around the user's today
export function thisWeekIn(timeZone: string | null): { monday: string; sunday: string } {
  // Work on the date only (midnight UTC), so time zones and daylight saving can't shift it
  const today = new Date(`${todayIn(timeZone)}T00:00:00Z`);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7; // getUTCDay: Sunday = 0, Monday = 1 ...
  const monday = addDays(today, -daysSinceMonday);
  return { monday: toDateString(monday), sunday: toDateString(addDays(monday, 6)) };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
