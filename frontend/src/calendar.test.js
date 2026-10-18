import { describe, expect, it } from 'vitest';
import { dueDateFromDrop, monthGrid, monthLabel, monthOf, NO_DATE, shiftMonth, weekdayLabels } from './calendar';

describe('calendar maths', () => {
  it('a month grid runs Monday to Sunday, from the week of the 1st to the week of the last day', () => {
    const weeks = monthGrid({ year: 2026, month: 10 }); // 1 Oct 2026 is a Thursday, 31 Oct a Saturday

    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toEqual({ date: '2026-09-28', day: 28, inMonth: false });
    expect(weeks[0][3]).toEqual({ date: '2026-10-01', day: 1, inMonth: true });
    expect(weeks[4][6]).toEqual({ date: '2026-11-01', day: 1, inMonth: false });
  });

  it('a month that starts on a Monday and ends on a Sunday is exactly its own weeks', () => {
    const weeks = monthGrid({ year: 2027, month: 2 }); // February 2027: Monday 1st to Sunday 28th

    expect(weeks).toHaveLength(4);
    expect(weeks[0][0].date).toBe('2027-02-01');
    expect(weeks[3][6].date).toBe('2027-02-28');
    expect(weeks.flat().every((d) => d.inMonth)).toBe(true);
  });

  it('moves between months, across year ends too', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthOf('2026-10-18')).toEqual({ year: 2026, month: 10 });
  });

  it('names months and weekdays, starting on Monday', () => {
    expect(monthLabel({ year: 2026, month: 10 })).toBe('October 2026');
    expect(weekdayLabels()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  describe('what a drop means', () => {
    const tasks = [
      { id: 1, dueDate: '2026-10-05' },
      { id: 2, dueDate: null },
    ];
    const drop = (draggableId, droppableId) => ({ draggableId, destination: droppableId && { droppableId, index: 0 } });

    it('a task dropped on another day gets that date', () => {
      expect(dueDateFromDrop(drop('1', '2026-10-09'), tasks)).toEqual({ taskId: 1, dueDate: '2026-10-09' });
    });

    it('a task dropped on "No due date" loses its date', () => {
      expect(dueDateFromDrop(drop('1', NO_DATE), tasks)).toEqual({ taskId: 1, dueDate: null });
    });

    it('nothing changes when dropped on the same day, or outside the calendar', () => {
      expect(dueDateFromDrop(drop('1', '2026-10-05'), tasks)).toBeNull();
      expect(dueDateFromDrop(drop('2', NO_DATE), tasks)).toBeNull();
      expect(dueDateFromDrop(drop('1', null), tasks)).toBeNull();
    });
  });
});
