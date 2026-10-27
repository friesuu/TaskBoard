import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiSection from './AiSection';
import { approvePrompt, requestPromptChanges, retryAiTask, updateRefinedPrompt } from '../api';

vi.mock('../api');

const AI = { id: 9, name: 'AI', color: 'TEAL' };
const base = {
  id: 5, title: 'Add search', status: 'TODO', labels: [AI],
  refinedPrompt: null, changesRequested: false, promptApprovedAt: null, aiBranch: null, aiError: null,
};

function renderSection(task, props = {}) {
  const handlers = { onTaskChanged: vi.fn(), onCommentsChanged: vi.fn(), onSessionEnded: vi.fn(() => false) };
  render(<AiSection task={{ ...base, ...task }} boardProject="notes-app" {...handlers} {...props} />);
  return handlers;
}

describe('AiSection', () => {
  beforeEach(() => {
    vi.mocked(updateRefinedPrompt).mockReset().mockImplementation(async (id, prompt) => ({ ...base, id, refinedPrompt: prompt }));
    vi.mocked(approvePrompt).mockReset().mockResolvedValue({ ...base, status: 'IN_PROGRESS' });
    vi.mocked(requestPromptChanges).mockReset().mockResolvedValue({ ...base, status: 'PROMPT_REVIEW', changesRequested: true });
    vi.mocked(retryAiTask).mockReset().mockResolvedValue({ ...base, aiError: null });
  });

  it("isn't shown on tasks Claude has nothing to do with", () => {
    renderSection({ labels: [] });
    expect(screen.queryByRole('region', { name: 'Claude' })).not.toBeInTheDocument();
  });

  it('says Claude will write a prompt, and that the board needs a project', () => {
    renderSection({}, { boardProject: null });
    expect(screen.getByText('Claude will write a prompt for this task on its next run.')).toBeInTheDocument();
    expect(screen.getByText(/only picks up AI tasks on boards with a project/)).toBeInTheDocument();
  });

  it("won't approve while a blank is left, then saves your edits and approves exactly that text", async () => {
    const { onTaskChanged } = renderSection({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal: search. [[FILL IN: which page?]]' });
    const box = screen.getByRole('textbox', { name: "Claude's prompt" });
    expect(screen.getByRole('button', { name: 'Approve prompt' })).toBeDisabled();

    await userEvent.clear(box);
    await userEvent.type(box, 'Goal: search on the notes page.');
    await userEvent.click(screen.getByRole('button', { name: 'Approve prompt' }));

    expect(updateRefinedPrompt).toHaveBeenCalledWith(5, 'Goal: search on the notes page.');
    expect(approvePrompt).toHaveBeenCalledWith(5);
    expect(onTaskChanged).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'IN_PROGRESS' }));
  });

  it('sends your change request to Claude and reloads the comments', async () => {
    const { onCommentsChanged } = renderSection({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal: search.' });

    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'What should Claude change?' }), 'Use the search helper');
    await userEvent.click(screen.getByRole('button', { name: 'Send to Claude' }));

    expect(requestPromptChanges).toHaveBeenCalledWith(5, 'Use the search helper');
    expect(onCommentsChanged).toHaveBeenCalledOnce();
  });

  it('shows the prompt read-only while Claude revises it', () => {
    renderSection({ status: 'PROMPT_REVIEW', refinedPrompt: 'Goal: search.', changesRequested: true });
    expect(screen.getByText(/^Revising…/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the branch while building and after', () => {
    renderSection({ status: 'AI_REVIEW', refinedPrompt: 'Goal', aiBranch: 'ai/task-5-add-search' });
    expect(screen.getByText(/Built on branch/)).toBeInTheDocument();
    expect(screen.getByText('git switch ai/task-5-add-search')).toBeInTheDocument();
  });

  it('shows why Claude stopped, with a way to try again', async () => {
    const { onTaskChanged } = renderSection({ aiError: 'The spend cap for this step was reached' });

    expect(screen.getByText('Claude stopped: The spend cap for this step was reached')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retryAiTask).toHaveBeenCalledWith(5);
    expect(onTaskChanged).toHaveBeenCalled();
  });
});
