import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DragDropContext } from '@hello-pangea/dnd';
import Column from './Column';
import { getChecklist, updateChecklistItem, getAttachments, attachmentDownloadUrl, deleteAttachment } from '../api';

vi.mock('../api'); // the checklist and files opened on a card load through the api

// Columns and cards only work inside a DragDropContext, just like in App
function renderColumn(tasks, handlers = {}) {
  const props = { onOpen: vi.fn(), ...handlers };
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
    expect(screen.getByRole('heading', { name: 'To do (0)' })).toBeInTheDocument();
    expect(screen.getByText('No tasks')).toBeInTheDocument();
  });

  it('shows each card with its full notes and a friendly due date', () => {
    const notes = 'For Monday.\nInclude the budget, the timeline and the risks, and the next steps after that.';
    renderColumn([{ id: 1, title: 'Write report', description: notes, status: 'TODO', dueDate: '2026-10-20' }]);
    expect(screen.getByRole('heading', { name: 'Write report' })).toBeInTheDocument();
    expect(screen.getByText(/For Monday\.\s+Include the budget.*next steps after that\./)).toBeInTheDocument();
    expect(screen.getByText('20 Oct')).toBeInTheDocument();
    expect(screen.queryByText('No tasks')).not.toBeInTheDocument();
  });

  it('says Today and Tomorrow for the next two days', () => {
    renderColumn([
      { id: 1, title: 'Now', description: null, status: 'TODO', dueDate: '2026-10-15' },
      { id: 2, title: 'Next', description: null, status: 'TODO', dueDate: '2026-10-16' },
    ]);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
  });

  it('marks an overdue card in words next to its date', () => {
    renderColumn([{ id: 1, title: 'Late one', description: null, status: 'TODO', dueDate: '2026-10-01' }]);
    expect(screen.getByText('1 Oct · Overdue')).toBeInTheDocument();
  });

  it("gives each card its column's colour edge", () => {
    renderColumn([{ id: 1, title: 'Busy one', description: null, status: 'IN_PROGRESS', dueDate: null }]);
    const card = screen.getByRole('heading', { name: 'Busy one' }).closest('.task-card');
    expect(card).toHaveClass('tone-warning'); // peach, like the In progress column
  });

  it('gives an AI task one small chip saying where Claude is with it', () => {
    const AI = [{ id: 9, name: 'AI', color: 'TEAL' }];
    const ai = (id, title, fields) => ({ id, title, description: null, dueDate: null, labels: AI, refinedPrompt: 'Goal', ...fields });
    renderColumn([
      ai(1, 'New one', { status: 'TODO', refinedPrompt: null }),
      ai(2, 'To approve', { status: 'PROMPT_REVIEW' }),
      ai(3, 'Being built', { status: 'IN_PROGRESS', promptApprovedAt: '2026-10-15T10:00:00Z', aiBranch: 'ai/task-3-x' }),
      ai(4, 'Built', { status: 'AI_REVIEW', aiBranch: 'ai/task-4-x', aiChecksPassed: true }),
      ai(5, 'Checks failed', { status: 'AI_REVIEW', aiBranch: 'ai/task-5-x', aiChecksPassed: false }),
      { id: 6, title: 'Not for Claude', description: null, status: 'TODO', dueDate: null },
    ], { agentTaskId: 3 });
    const chipOf = (title) => screen.getByRole('heading', { name: title }).closest('.task-card').querySelector('.ai-chip');

    expect(chipOf('New one')).toHaveTextContent('Refining prompt');
    expect(chipOf('To approve')).toHaveTextContent('Needs your approval');
    expect(chipOf('Being built')).toHaveTextContent('Working');
    expect(chipOf('Built')).toHaveTextContent('Ready for review');
    expect(chipOf('Checks failed')).toHaveTextContent('Failed');
    expect(chipOf('Not for Claude')).toBeNull();
    // Only the task the runner is on right now pulses
    expect(chipOf('Being built').querySelector('.dot')).toHaveClass('pulsing');
    expect(chipOf('New one').querySelector('.dot')).not.toHaveClass('pulsing');
  });

  it('keeps the card itself simple: no column dropdown, Open button or bin', () => {
    renderColumn([{ id: 3, title: 'Card', description: null, status: 'TODO', dueDate: null }]);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    // and no empty ☑ 0/0 or 📎 0
    expect(screen.queryByRole('button', { name: /Checklist/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Files/ })).not.toBeInTheDocument();
  });

  it('clicking the title or anywhere on the card opens the task', async () => {
    const { onOpen } = renderColumn([{ id: 3, title: 'Card', description: 'Some notes', status: 'TODO', dueDate: null }]);

    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    expect(onOpen).toHaveBeenCalledTimes(1); // once, not again from the card underneath
    await userEvent.click(screen.getByText('Some notes'));

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
    const { onOpen } = renderColumn(
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
    expect(onOpen).not.toHaveBeenCalled(); // using the checklist on the card doesn't open the panel
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
