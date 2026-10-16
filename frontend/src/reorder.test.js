import { describe, expect, it } from 'vitest';
import { moveInList } from './reorder';

// A small board: the order inside each column is the order in this list
const tasks = [
  { id: 1, title: 'A', status: 'TODO' },
  { id: 2, title: 'B', status: 'TODO' },
  { id: 3, title: 'C', status: 'TODO' },
  { id: 4, title: 'X', status: 'DONE' },
  { id: 5, title: 'Y', status: 'DONE' },
];

// The titles of one column, in board order
const column = (list, status) => list.filter((t) => t.status === status).map((t) => t.title);

describe('moveInList', () => {
  it('moves a task up inside its column', () => {
    const result = moveInList(tasks, 3, 'TODO', 0);
    expect(column(result, 'TODO')).toEqual(['C', 'A', 'B']);
  });

  it('moves a task down inside its column', () => {
    const result = moveInList(tasks, 1, 'TODO', 2);
    expect(column(result, 'TODO')).toEqual(['B', 'C', 'A']);
  });

  it('moves a task between two tasks of another column and changes its status', () => {
    const result = moveInList(tasks, 1, 'DONE', 1);
    expect(column(result, 'DONE')).toEqual(['X', 'A', 'Y']);
    expect(column(result, 'TODO')).toEqual(['B', 'C']);
    expect(result.find((t) => t.id === 1).status).toBe('DONE');
  });

  it('puts the task at the bottom when the position is past the end', () => {
    const result = moveInList(tasks, 1, 'DONE', 99);
    expect(column(result, 'DONE')).toEqual(['X', 'Y', 'A']);
  });

  it('does not change the original list (React needs a new one to notice)', () => {
    const copy = structuredClone(tasks);
    moveInList(tasks, 1, 'DONE', 0);
    expect(tasks).toEqual(copy);
  });

  it('returns the list unchanged for an unknown id', () => {
    expect(moveInList(tasks, 999, 'DONE', 0)).toBe(tasks);
  });
});
