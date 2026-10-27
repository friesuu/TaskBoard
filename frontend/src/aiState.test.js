import { describe, expect, it } from 'vitest';
import { aiStateOf, aiStepOf, durationOf, runResultText, timeAgo } from './aiState';

const AI = [{ id: 1, name: 'ai', color: 'TEAL' }];
const task = (fields) => ({ status: 'TODO', labels: AI, refinedPrompt: null, ...fields });

describe('aiState', () => {
  it('puts each AI task in one of five states', () => {
    expect(aiStateOf(task({}))).toBe('refining');
    expect(aiStateOf(task({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal' }))).toBe('approval');
    expect(aiStateOf(task({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal', changesRequested: true }))).toBe('refining');
    expect(aiStateOf(task({ status: 'IN_PROGRESS', refinedPrompt: 'Goal', promptApprovedAt: '2026-10-27T01:00:00Z' }))).toBe('working');
    expect(aiStateOf(task({ status: 'AI_REVIEW', aiBranch: 'ai/task-1-x', aiChecksPassed: true }))).toBe('review');
    expect(aiStateOf(task({ status: 'AI_REVIEW', aiBranch: 'ai/task-1-x', aiChecksPassed: false }))).toBe('failed');
    expect(aiStateOf(task({ aiError: 'The spend cap was reached' }))).toBe('failed');
  });

  it("shows nothing for tasks Claude has nothing to do with, or that are done", () => {
    expect(aiStateOf({ status: 'TODO', labels: [] })).toBeNull();
    expect(aiStateOf(task({ status: 'DONE', aiBranch: 'ai/task-1-x' }))).toBeNull();
    expect(aiStateOf(task({ status: 'IN_PROGRESS' }))).toBeNull(); // dragged there by hand, never approved
  });

  it('knows which step of Refine → Approve → Work → Review a task is on', () => {
    const steps = [task({}), task({ status: 'PROMPT_REVIEW' }), task({ status: 'IN_PROGRESS' }), task({ status: 'AI_REVIEW' })]
      .map(aiStepOf);
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  it('words runs and times the friendly way', () => {
    const run = {
      status: 'succeeded', result: 'built', checksPassed: true,
      startedAt: '2026-10-27T01:00:00Z', finishedAt: '2026-10-27T01:01:22Z',
    };
    expect(runResultText(run)).toBe('Built · checks passed');
    expect(durationOf(run)).toBe('1m 22s');
    expect(runResultText({ ...run, status: 'running' })).toBe('Running');

    const now = new Date('2026-10-27T12:00:00Z');
    expect(timeAgo('2026-10-27T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-10-27T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo('2026-10-27T10:00:00Z', now)).toBe('2 h ago');
    expect(timeAgo('2026-10-24T12:00:00Z', now)).toBe('3 days ago');
  });
});
