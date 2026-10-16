import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskDetails from './TaskDetails';
import { getChecklist, getComments } from '../api';

vi.mock('../api');

const task = {
  id: 5, title: 'Plan party', description: 'Line one\nLine two', status: 'IN_PROGRESS', dueDate: '2026-10-30',
  checklistDone: 0, checklistTotal: 0,
};

function renderDetails(props = {}) {
  const handlers = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onChecklistProgress: vi.fn(),
    onSessionEnded: vi.fn(() => false),
    onClose: vi.fn(),
  };
  render(<TaskDetails task={task} currentUserId={1} {...handlers} {...props} />);
  return handlers;
}

describe('TaskDetails', () => {
  beforeEach(() => {
    vi.mocked(getChecklist).mockReset().mockResolvedValue([]);
    vi.mocked(getComments).mockReset().mockResolvedValue([]);
  });

  it('shows the task, its full notes, checklist and comments', async () => {
    renderDetails();

    expect(screen.getByRole('dialog', { name: 'Plan party' })).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Due 2026-10-30')).toBeInTheDocument();
    expect(screen.getByText(/Line one\s+Line two/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
  });

  it('edits the title, notes and due date through App', async () => {
    const { onSave } = renderDetails();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const notes = screen.getByLabelText('Notes');
    await userEvent.clear(notes);
    await userEvent.type(notes, 'New notes');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(5, { title: 'Plan party', description: 'New notes', dueDate: '2026-10-30' });
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument(); // back to viewing
  });

  it('closes with ✕, Escape, or a click outside', async () => {
    const { onClose } = renderDetails();

    await userEvent.click(screen.getByRole('button', { name: 'Close task' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('dialog').parentElement); // the dark backdrop

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('tells App which task the checklist progress belongs to', async () => {
    vi.mocked(getChecklist).mockResolvedValue([{ id: 1, text: 'Cake', done: false, position: 0 }]);
    const { onChecklistProgress } = renderDetails();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Cake' }));

    expect(onChecklistProgress).toHaveBeenLastCalledWith(5, 1, 1);
  });
});
