import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DragDropContext } from '@hello-pangea/dnd';
import Column from './Column';
import { getChecklist, updateChecklistItem, getAttachments, attachmentDownloadUrl, deleteAttachment } from '../api';

vi.mock('../api'); // the checklist and files opened on a card load through the api

// Columns and cards only work inside a DragDropContext, just like in App
function renderColumn(tasks, handlers = {}) {
  const props = { onStatusChange: vi.fn(), onDelete: vi.fn(), onOpen: vi.fn(), ...handlers };
  render(
    <DragDropContext onDragEnd={() => {}}>
      <Column status="TODO" title="To do" tasks={tasks} {...props} />
    </DragDropContext>,
  );
  return props;
}

describe('Column and TaskCard', () => {
  // Fixed "today" so "overdue" doesn't depend on when the tests run
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('shows "No tasks" when the column is empty', () => {
    renderColumn([]);
    expect(screen.getByRole('heading', { name: 'To do' })).toBeInTheDocument();
    expect(screen.getByText('No tasks')).toBeInTheDocument();
  });

  it('shows each card with its details', () => {
    renderColumn([{ id: 1, title: 'Write report', description: 'For Monday', status: 'TODO', dueDate: '2026-10-20' }]);
    expect(screen.getByRole('heading', { name: 'Write report' })).toBeInTheDocument();
    expect(screen.getByText('For Monday')).toBeInTheDocument();
    expect(screen.queryByText('No tasks')).not.toBeInTheDocument();
  });

  it('marks an overdue card', () => {
    renderColumn([{ id: 1, title: 'Late one', description: null, status: 'TODO', dueDate: '2026-10-01' }]);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('deletes only after you confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onDelete } = renderColumn([{ id: 7, title: 'Old task', description: null, status: 'TODO', dueDate: null }]);
    const bin = screen.getByRole('button', { name: 'Delete "Old task"' });

    await userEvent.click(bin); // Cancel
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(bin); // OK
    expect(confirm).toHaveBeenCalledWith('Delete "Old task"?');
    expect(onDelete).toHaveBeenCalledWith(7);
  });

  it('the status dropdown moves the card', async () => {
    const { onStatusChange } = renderColumn([{ id: 3, title: 'Card', description: null, status: 'TODO', dueDate: null }]);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'DONE');
    expect(onStatusChange).toHaveBeenCalledWith(3, 'DONE');
  });

  it('the title and Open both ask App to open the task', async () => {
    const { onOpen } = renderColumn([{ id: 3, title: 'Card', description: null, status: 'TODO', dueDate: null }]);

    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith(3);
  });

  it("shows the card's labels", () => {
    renderColumn([{
      id: 1, title: 'Labelled', description: null, status: 'TODO', dueDate: null,
      labels: [{ id: 1, name: 'Client', color: 'TEAL' }, { id: 2, name: 'Urgent', color: 'ORANGE' }],
    }]);

    expect(screen.getByText('Client')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('shows the checklist progress and the number of files as buttons on the card', () => {
    renderColumn([
      { id: 1, title: 'With list', description: null, status: 'TODO', dueDate: null, checklistDone: 2, checklistTotal: 5, attachmentCount: 3 },
    ]);

    expect(screen.getByRole('button', { name: 'Checklist, 2 of 5 done' })).toHaveTextContent('2/5');
    expect(screen.getByRole('button', { name: 'Files, 3' })).toHaveTextContent('3');
  });

  it('opens the checklist on the card, where items can be ticked', async () => {
    vi.mocked(getChecklist).mockResolvedValue([{ id: 9, text: 'Outline', done: false, position: 0 }]);
    vi.mocked(updateChecklistItem).mockResolvedValue({});
    const onChecklistProgress = vi.fn();
    renderColumn(
      [{ id: 1, title: 'Report', description: null, status: 'TODO', dueDate: null, checklistDone: 0, checklistTotal: 1 }],
      { onChecklistProgress },
    );

    const toggle = screen.getByRole('button', { name: 'Checklist, 0 of 1 done' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Outline' }));

    expect(updateChecklistItem).toHaveBeenCalledWith(9, { done: true });
    expect(onChecklistProgress).toHaveBeenLastCalledWith(1, 1, 1); // task 1: 1 of 1 done
    // On the card: no reorder or delete (those are in the task panel)
    expect(screen.queryByRole('button', { name: 'Delete "Outline"' })).not.toBeInTheDocument();

    await userEvent.click(toggle); // folds it away again
    expect(screen.queryByRole('checkbox', { name: 'Outline' })).not.toBeInTheDocument();
  });

  it('opens the files on the card, as download links', async () => {
    vi.mocked(getAttachments).mockResolvedValue([{ id: 4, fileName: 'plan.pdf', mimeType: 'application/pdf', size: 900, taskId: 1 }]);
    vi.mocked(attachmentDownloadUrl).mockReturnValue('http://api.test/api/attachments/4/download');
    renderColumn([{ id: 1, title: 'Report', description: null, status: 'TODO', dueDate: null, attachmentCount: 1 }]);

    await userEvent.click(screen.getByRole('button', { name: 'Files, 1' }));

    expect(await screen.findByRole('link', { name: 'plan.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeInTheDocument();
  });

  it('deletes a file from the card after you confirm, and updates the count', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(getAttachments).mockResolvedValue([{ id: 4, fileName: 'plan.pdf', mimeType: 'application/pdf', size: 900, taskId: 1 }]);
    vi.mocked(attachmentDownloadUrl).mockReturnValue('http://api.test/api/attachments/4/download');
    vi.mocked(deleteAttachment).mockResolvedValue(undefined);
    const onAttachmentCount = vi.fn();
    renderColumn(
      [{ id: 1, title: 'Report', description: null, status: 'TODO', dueDate: null, attachmentCount: 1 }],
      { onAttachmentCount },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Files, 1' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete "plan.pdf"' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "plan.pdf"?');
    expect(deleteAttachment).toHaveBeenCalledWith(4);
    expect(screen.queryByRole('link', { name: 'plan.pdf' })).not.toBeInTheDocument();
    expect(onAttachmentCount).toHaveBeenCalledWith(1, 0); // task 1 now has 0 files
  });
});
