import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FilterBar from './FilterBar';
import { EMPTY_FILTERS } from '../filters';

const labels = [
  { id: 1, name: 'Client', color: 'TEAL' },
  { id: 2, name: 'Urgent', color: 'ORANGE' },
];

function renderBar(filters = EMPTY_FILTERS) {
  const onChange = vi.fn();
  render(<FilterBar filters={filters} labels={labels} onChange={onChange} />);
  return onChange;
}

describe('FilterBar', () => {
  it('searches once you pause typing, not on every key', async () => {
    const onChange = renderBar();

    await userEvent.type(screen.getByLabelText('Search tasks'), 'report');
    expect(onChange).not.toHaveBeenCalled(); // still waiting for the pause

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, q: 'report' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('filters by label from the Labels menu', async () => {
    const onChange = renderBar();

    await userEvent.click(screen.getByRole('button', { name: 'Labels' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, labels: [2] });
  });

  it('shows how many labels are chosen, and closes the menu with Escape', async () => {
    renderBar({ ...EMPTY_FILTERS, labels: [1, 2] });

    await userEvent.click(screen.getByRole('button', { name: 'Labels, 2 chosen' }));
    expect(screen.getByRole('checkbox', { name: 'Client' })).toBeChecked();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('checkbox', { name: 'Client' })).not.toBeInTheDocument();
  });

  it('filters by due date', async () => {
    const onChange = renderBar();

    await userEvent.selectOptions(screen.getByLabelText('Due date'), 'Overdue');

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, due: 'OVERDUE' });
  });

  it('turns a column on and off', async () => {
    const onChange = renderBar({ ...EMPTY_FILTERS, status: ['DONE'] });

    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'To do' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onChange).toHaveBeenNthCalledWith(1, { ...EMPTY_FILTERS, status: ['DONE', 'TODO'] });
    expect(onChange).toHaveBeenNthCalledWith(2, { ...EMPTY_FILTERS, status: [] });
  });

  it('offers Clear filters, and the drag-and-drop note, only while a filter is on', async () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('Clear filters switches everything off', async () => {
    const onChange = renderBar({ q: 'report', labels: [1], due: 'TODAY', status: ['TODO'] });

    expect(screen.getByText("Filters are on, so cards can't be dragged. Clear them to reorder.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });
});
