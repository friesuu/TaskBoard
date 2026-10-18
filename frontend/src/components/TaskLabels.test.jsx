import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskLabels from './TaskLabels';
import { setTaskLabels } from '../api';

vi.mock('../api');

const boardLabels = [
  { id: 1, name: 'Client', color: 'TEAL' },
  { id: 2, name: 'Urgent', color: 'ORANGE' },
];

function renderLabels(task, props = {}) {
  const handlers = { onTaskChanged: vi.fn(), onSessionEnded: vi.fn(() => false) };
  render(<TaskLabels task={task} boardLabels={boardLabels} {...handlers} {...props} />);
  return handlers;
}

describe('TaskLabels', () => {
  beforeEach(() => {
    vi.mocked(setTaskLabels).mockReset();
  });

  it("shows the task's labels", () => {
    renderLabels({ id: 5, labels: [boardLabels[1]] });
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.queryByText('Client')).not.toBeInTheDocument(); // not picked, and the list is closed
  });

  it('says so when the task has no labels', () => {
    renderLabels({ id: 5, labels: [] });
    expect(screen.getByText('No labels.')).toBeInTheDocument();
  });

  it('ticking a label saves the new set and hands the updated task to App', async () => {
    const updated = { id: 5, labels: [boardLabels[0], boardLabels[1]] };
    vi.mocked(setTaskLabels).mockResolvedValue(updated);
    const { onTaskChanged } = renderLabels({ id: 5, labels: [boardLabels[1]] });

    await userEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
    expect(screen.getByRole('checkbox', { name: 'Urgent' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Client' }));

    expect(setTaskLabels).toHaveBeenCalledWith(5, [2, 1]);
    expect(onTaskChanged).toHaveBeenCalledWith(updated);
  });

  it('unticking removes it', async () => {
    vi.mocked(setTaskLabels).mockResolvedValue({ id: 5, labels: [] });
    renderLabels({ id: 5, labels: [boardLabels[1]] });

    await userEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }));

    expect(setTaskLabels).toHaveBeenCalledWith(5, []);
  });

  it('points to Board settings when the board has no labels', async () => {
    renderLabels({ id: 5, labels: [] }, { boardLabels: [] });

    await userEvent.click(screen.getByRole('button', { name: 'Edit labels' }));

    expect(screen.getByText('This board has no labels yet. Add them in Board settings.')).toBeInTheDocument();
  });

  it('shows the error when saving fails', async () => {
    vi.mocked(setTaskLabels).mockRejectedValue(new Error('Label not found on this board'));
    renderLabels({ id: 5, labels: [] });

    await userEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Client' }));

    expect(await screen.findByText('Label not found on this board')).toBeInTheDocument();
  });
});
