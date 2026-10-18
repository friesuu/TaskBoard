import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LabelManager from './LabelManager';
import { createLabel, updateLabel, deleteLabel } from '../api';

vi.mock('../api');

const labels = [
  { id: 1, name: 'Client', color: 'TEAL' },
  { id: 2, name: 'Urgent', color: 'ORANGE' },
];

function renderManager(props = {}) {
  const handlers = { onLabelsChanged: vi.fn(), onSessionEnded: vi.fn(() => false) };
  render(<LabelManager boardId={10} labels={labels} {...handlers} {...props} />);
  return handlers;
}

describe('LabelManager', () => {
  beforeEach(() => {
    vi.mocked(createLabel).mockReset();
    vi.mocked(updateLabel).mockReset();
    vi.mocked(deleteLabel).mockReset().mockResolvedValue(undefined);
  });

  it("lists the board's labels", () => {
    renderManager();
    expect(screen.getByText('Client')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('says so when there are no labels yet', () => {
    renderManager({ labels: [] });
    expect(screen.getByText('No labels yet. Add one below.')).toBeInTheDocument();
  });

  it('adds a label with the chosen colour, and passes on the new A-Z list', async () => {
    vi.mocked(createLabel).mockResolvedValue({ id: 3, name: 'Blocked', color: 'PINK' });
    const { onLabelsChanged } = renderManager();

    await userEvent.type(screen.getByLabelText('New label'), '  Blocked  ');
    await userEvent.click(screen.getAllByRole('radio', { name: 'Pink' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }));

    expect(createLabel).toHaveBeenCalledWith(10, 'Blocked', 'PINK');
    expect(onLabelsChanged).toHaveBeenCalledWith([
      { id: 3, name: 'Blocked', color: 'PINK' },
      labels[0],
      labels[1],
    ]);
    expect(screen.getByLabelText('New label')).toHaveValue('');
  });

  it('shows the server message when the name is taken', async () => {
    vi.mocked(createLabel).mockRejectedValue(new Error('There is already a label called "Urgent" on this board'));
    renderManager();

    await userEvent.type(screen.getByLabelText('New label'), 'Urgent');
    await userEvent.click(screen.getByRole('button', { name: 'Add label' }));

    expect(await screen.findByText('There is already a label called "Urgent" on this board')).toBeInTheDocument();
  });

  it('renames and recolours a label', async () => {
    vi.mocked(updateLabel).mockResolvedValue({ id: 2, name: 'Critical', color: 'PURPLE' });
    const { onLabelsChanged } = renderManager();

    await userEvent.click(screen.getByRole('button', { name: 'Edit label "Urgent"' }));
    const nameBox = screen.getByLabelText('Label name');
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, 'Critical');
    // two colour pickers are on screen now (editing + new label); the first is the one being edited
    await userEvent.click(screen.getAllByRole('radio', { name: 'Purple' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateLabel).toHaveBeenCalledWith(2, { name: 'Critical', color: 'PURPLE' });
    expect(onLabelsChanged).toHaveBeenCalledWith([labels[0], { id: 2, name: 'Critical', color: 'PURPLE' }]);
  });

  it('deletes a label only after you confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onLabelsChanged } = renderManager();
    const bin = screen.getByRole('button', { name: 'Delete label "Client"' });

    await userEvent.click(bin); // Cancel
    expect(deleteLabel).not.toHaveBeenCalled();

    await userEvent.click(bin); // OK
    expect(confirm).toHaveBeenCalledWith('Delete the label "Client"? It will be taken off every task that has it.');
    expect(deleteLabel).toHaveBeenCalledWith(1);
    expect(onLabelsChanged).toHaveBeenCalledWith([labels[1]]);
  });
});
