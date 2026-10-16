import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOverdue, todayString } from './dates';

describe('dates', () => {
  // Pretend today is 15 October 2026, so the tests give the same result on any day
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0)); // months count from 0, so 9 = October
  });
  afterEach(() => vi.useRealTimers());

  it('todayString gives the local date as YYYY-MM-DD', () => {
    expect(todayString()).toBe('2026-10-15');
  });

  it('a task due before today is overdue', () => {
    expect(isOverdue({ dueDate: '2026-10-14', status: 'TODO' })).toBe(true);
  });

  it('a task due today is not overdue yet', () => {
    expect(isOverdue({ dueDate: '2026-10-15', status: 'TODO' })).toBe(false);
  });

  it('a finished task is never overdue', () => {
    expect(isOverdue({ dueDate: '2026-01-01', status: 'DONE' })).toBe(false);
  });

  it('a task without a due date is never overdue', () => {
    expect(isOverdue({ dueDate: null, status: 'TODO' })).toBe(false);
  });
});
