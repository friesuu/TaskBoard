import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DragDropContext } from '@hello-pangea/dnd';
import Column from './Column';

// Columns and cards only work inside a DragDropContext, just like in App
function renderColumn(tasks, handlers = {}) {
  const props = { onStatusChange: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), ...handlers };
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

  it('Edit opens the edit form', async () => {
    renderColumn([{ id: 3, title: 'Card', description: null, status: 'TODO', dueDate: null }]);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Card')).toBeInTheDocument();
  });
});
