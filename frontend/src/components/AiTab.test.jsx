import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiTab from './AiTab';
import {
  approvePrompt, getAgentRuns, getAiNotes, getRunLog, requestPromptChanges, retryAiTask, updateRefinedPrompt,
} from '../api';

vi.mock('../api');

const AI = { id: 9, name: 'AI', color: 'TEAL' };
const base = {
  id: 5, title: 'Add search', status: 'TODO', labels: [AI],
  refinedPrompt: null, changesRequested: false, promptApprovedAt: null, aiBranch: null, aiBuiltAt: null,
  aiChecksPassed: null, aiError: null,
};
const buildRun = {
  id: 31, step: 'build', status: 'succeeded', result: 'built', project: 'notes-app', branch: 'ai/task-5-add-search',
  checksPassed: true, costUsd: 0.53, error: null, summary: 'Done: the build and tests passed.\n\nFiles:\nM\tsrc/App.jsx',
  startedAt: '2026-10-27T01:00:00Z', finishedAt: '2026-10-27T01:01:22Z',
};

function renderTab(task, props = {}) {
  const handlers = { onTaskChanged: vi.fn(), onAiChanged: vi.fn(), onSessionEnded: vi.fn(() => false) };
  const { rerender } = render(<AiTab task={{ ...base, ...task }} boardProject="notes-app" {...handlers} {...props} />);
  // As App does after a save: the panel gets the updated task
  const update = (changes) => rerender(<AiTab task={{ ...base, ...task, ...changes }} boardProject="notes-app" {...handlers} {...props} />);
  return { ...handlers, update };
}

describe('AiTab', () => {
  beforeEach(() => {
    vi.mocked(getAgentRuns).mockReset().mockResolvedValue([]);
    vi.mocked(getAiNotes).mockReset().mockResolvedValue([]);
    vi.mocked(getRunLog).mockReset().mockResolvedValue([]);
    vi.mocked(updateRefinedPrompt).mockReset().mockImplementation(async (id, prompt) => ({ ...base, id, refinedPrompt: prompt }));
    vi.mocked(approvePrompt).mockReset().mockResolvedValue({ ...base, status: 'IN_PROGRESS' });
    vi.mocked(requestPromptChanges).mockReset().mockResolvedValue({ ...base, status: 'PROMPT_REVIEW', changesRequested: true });
    vi.mocked(retryAiTask).mockReset().mockResolvedValue({ ...base, aiError: null });
  });

  it('says Claude will write a prompt, and that the board needs a project', async () => {
    renderTab({}, { boardProject: null });
    expect(screen.getByText('Refining prompt')).toBeInTheDocument();
    expect(screen.getByText('Claude will write a prompt for this task on its next run.')).toBeInTheDocument();
    expect(screen.getByText(/only picks up AI tasks on boards with a project/)).toBeInTheDocument();
    expect(await screen.findByText('No runs yet.')).toBeInTheDocument();
  });

  it('shows where the task is in Refine → Approve → Work → Review', () => {
    renderTab({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal' });
    expect(screen.getByText('Needs your approval')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Progress' });
    expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent('Approve');
    expect(steps.querySelector('.ai-step.done')).toHaveTextContent('Refine (done)');
  });

  it("won't approve while a blank is left; Edit, Save, then Approve", async () => {
    const { onTaskChanged, onAiChanged, update } = renderTab({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal: search. [[FILL IN: which page?]]' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); // the prompt is shown formatted, to read
    expect(screen.getByText('1 blank to fill in before you can approve.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve prompt' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: "Claude's prompt" });
    expect(screen.queryByRole('button', { name: 'Approve prompt' })).not.toBeInTheDocument(); // one thing at a time
    await userEvent.clear(box);
    await userEvent.type(box, 'Goal: search on the notes page.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateRefinedPrompt).toHaveBeenCalledWith(5, 'Goal: search on the notes page.');
    update({ refinedPrompt: 'Goal: search on the notes page.' });

    await userEvent.click(screen.getByRole('button', { name: 'Approve prompt' }));
    expect(approvePrompt).toHaveBeenCalledWith(5);
    expect(onTaskChanged).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'IN_PROGRESS' }));
    expect(onAiChanged).toHaveBeenCalled(); // the bell and the runner's status catch up
  });

  it('Cancel throws away your edits', async () => {
    renderTab({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal: search.' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByRole('textbox', { name: "Claude's prompt" }), ' Oops');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Goal: search.')).toBeInTheDocument();
    expect(updateRefinedPrompt).not.toHaveBeenCalled();
  });

  it('clicking a blank opens the edit box on it, and Next blank goes to the next one', async () => {
    renderTab({ status: 'PROMPT_REVIEW', refinedPrompt: 'Page: [[FILL IN: which page?]]\nSize: `[[FILL IN: how big?]]`' });

    await userEvent.click(screen.getByRole('button', { name: '[[FILL IN: how big?]]' }));
    const box = screen.getByRole('textbox', { name: "Claude's prompt" });
    expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe('[[FILL IN: how big?]]');

    await userEvent.click(screen.getByRole('button', { name: 'Next blank (2 left)' })); // wraps round to the first
    expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe('[[FILL IN: which page?]]');

    await userEvent.type(box, 'notes', { skipClick: true }); // typing replaces the selected blank
    expect(screen.getByRole('button', { name: 'Next blank (1 left)' })).toBeInTheDocument();
  });

  it('Reject sends your feedback to Claude, which rewrites the prompt', async () => {
    const { onTaskChanged } = renderTab({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal: search.' });

    await userEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'What should Claude change?' }), 'Use the search helper');
    await userEvent.click(screen.getByRole('button', { name: 'Send to Claude' }));

    expect(requestPromptChanges).toHaveBeenCalledWith(5, 'Use the search helper');
    expect(onTaskChanged).toHaveBeenCalledWith(expect.objectContaining({ changesRequested: true }));
  });

  it('shows the prompt read-only while Claude rewrites it', () => {
    renderTab({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal: search.', changesRequested: true });
    expect(screen.getByText('Claude is rewriting the prompt with your feedback.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it("shows the last build's summary, and a run's step-by-step log when you open it", async () => {
    vi.mocked(getAgentRuns).mockResolvedValue([buildRun]);
    vi.mocked(getRunLog).mockResolvedValue([{ id: 1, at: '2026-10-27T01:00:05Z', kind: 'claude', text: "I'll add the search box." }]);
    renderTab({ status: 'AI_REVIEW', refinedPrompt: 'Goal', aiBranch: 'ai/task-5-add-search', aiChecksPassed: true });

    expect(screen.getByText('Ready for review')).toBeInTheDocument();
    expect(await screen.findByText('Building · Built · checks passed · 1m 22s')).toBeInTheDocument();
    expect(screen.getByText(/Done: the build and tests passed/)).toBeInTheDocument();
    expect(screen.getByText('Logs (1 run)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Building/ }));
    expect(await screen.findByText("I'll add the search box.")).toBeInTheDocument();
    expect(getRunLog).toHaveBeenCalledWith(31);
  });

  it("keeps your feedback and Claude's older notes, folded away", async () => {
    vi.mocked(getAiNotes).mockResolvedValue([
      { id: 1, body: 'Shorter please', kind: 'feedback', createdAt: '2026-10-27T01:00:00Z' },
      { id: 2, body: 'I wrote a prompt for this task', kind: 'claude', createdAt: '2026-10-27T00:50:00Z' },
    ]);
    renderTab({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal' });
    expect(await screen.findByText("Your feedback and Claude's notes (2)")).toBeInTheDocument();
    expect(screen.getByText('Shorter please')).toBeInTheDocument();
  });

  it('shows why Claude stopped, with a way to try again', async () => {
    const { onTaskChanged } = renderTab({ aiError: 'The spend cap for this step was reached' });

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Claude stopped: The spend cap for this step was reached')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retryAiTask).toHaveBeenCalledWith(5);
    expect(onTaskChanged).toHaveBeenCalled();
  });
});
