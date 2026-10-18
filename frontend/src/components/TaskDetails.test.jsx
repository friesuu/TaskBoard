import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskDetails from './TaskDetails';
import { getChecklist, getComments, getAttachments } from '../api';

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
    onStatusChange: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<TaskDetails task={task} currentUserId={1} {...handlers} {...props} />);
  return handlers;
}

describe('TaskDetails', () => {
  beforeEach(() => {
    vi.mocked(getChecklist).mockReset().mockResolvedValue([]);
    vi.mocked(getComments).mockReset().mockResolvedValue([]);
    vi.mocked(getAttachments).mockReset().mockResolvedValue([]);
    // Fixed "today" so the friendly due date and "overdue" don't depend on when the tests run
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('shows the task, its full notes, checklist and comments', async () => {
    renderDetails();

    expect(screen.getByRole('dialog', { name: 'Plan party' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Column' })).toHaveValue('IN_PROGRESS');
    expect(screen.getByText('Due 30 Oct')).toBeInTheDocument();
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

  it('says when the task is overdue', () => {
    renderDetails({ task: { ...task, dueDate: '2026-10-14' } });
    expect(screen.getByText('Due Yesterday · Overdue')).toBeInTheDocument();
  });

  it('the Column dropdown moves the task to another column', async () => {
    const { onStatusChange } = renderDetails();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Column' }), 'DONE');
    expect(onStatusChange).toHaveBeenCalledWith(5, 'DONE');
  });

  it('deletes the task only after you confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onDelete } = renderDetails();
    const button = screen.getByRole('button', { name: 'Delete task' });

    await userEvent.click(button); // Cancel
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(button); // OK
    expect(confirm).toHaveBeenCalledWith('Delete "Plan party"?');
    expect(onDelete).toHaveBeenCalledWith(5);
  });

  it("shows the task's files", async () => {
    vi.mocked(getAttachments).mockResolvedValue([{ id: 1, fileName: 'plan.pdf', mimeType: 'application/pdf', size: 900, taskId: 5 }]);
    renderDetails();

    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(await screen.findByText('plan.pdf')).toBeInTheDocument();
    expect(getAttachments).toHaveBeenCalledWith(5);
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
