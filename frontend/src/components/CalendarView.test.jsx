import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CalendarView from './CalendarView';

const tasks = [
  { id: 1, title: 'Write report', status: 'TODO', dueDate: '2026-10-20' },
  { id: 2, title: 'Pay invoice', status: 'IN_PROGRESS', dueDate: '2026-10-02' }, // before "today": overdue
  { id: 3, title: 'Plan party', status: 'TODO', dueDate: null },
  { id: 4, title: 'November thing', status: 'TODO', dueDate: '2026-11-12' },
];

function renderCalendar() {
  const handlers = { onOpen: vi.fn(), onDueDateChange: vi.fn() };
  render(<CalendarView tasks={tasks} {...handlers} />);
  return handlers;
}

// The day cell holding a date (its number has the full date as its accessible name)
const dayCell = (date) => screen.getByLabelText(date).parentElement;

describe('CalendarView', () => {
  // A fixed "today": 15 October 2026
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("opens on this month and marks today", () => {
    renderCalendar();

    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(dayCell('2026-10-15')).toHaveClass('today');
  });

  it('puts each task on its due day', () => {
    renderCalendar();

    expect(within(dayCell('2026-10-20')).getByRole('button', { name: 'Write report' })).toBeInTheDocument();
    expect(within(dayCell('2026-10-02')).getByRole('button', { name: 'Pay invoice' })).toHaveClass('overdue');
  });

  it('lists the tasks without a due date beside the month', () => {
    renderCalendar();

    const undated = screen.getByRole('region', { name: 'No due date' });
    expect(within(undated).getByRole('button', { name: 'Plan party' })).toBeInTheDocument();
    expect(within(undated).queryByRole('button', { name: 'Write report' })).not.toBeInTheDocument();
  });

  it('moves between months, and Today comes back', async () => {
    renderCalendar();

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'November thing' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
  });

  it('clicking a task opens it', async () => {
    const { onOpen } = renderCalendar();

    await userEvent.click(screen.getByRole('button', { name: 'Write report' }));

    expect(onOpen).toHaveBeenCalledWith(1);
  });
});
