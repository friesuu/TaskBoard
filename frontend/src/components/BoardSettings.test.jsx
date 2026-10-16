import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BoardSettings from './BoardSettings';

const board = { id: 20, name: 'Work' };

function renderSettings(props = {}) {
  const handlers = { onRename: vi.fn(), onDelete: vi.fn() };
  render(<BoardSettings board={board} canDelete {...handlers} {...props} />);
  return handlers;
}

describe('BoardSettings', () => {
  it('renames the board (trimmed)', async () => {
    const { onRename } = renderSettings();

    const input = screen.getByLabelText('Board name');
    await userEvent.clear(input);
    await userEvent.type(input, '  Office  ');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onRename).toHaveBeenCalledWith('Office');
  });

  it('shows the error when renaming fails', async () => {
    renderSettings({ onRename: vi.fn().mockRejectedValue(new Error('name must be shorter')) });

    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(await screen.findByText('name must be shorter')).toBeInTheDocument();
  });

  it('asks before deleting, and does nothing if you cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onDelete } = renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Delete board' }));

    expect(confirm).toHaveBeenCalledWith('Delete "Work" and all its tasks? This can\'t be undone.');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes after you confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onDelete } = renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Delete board' }));

    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('cannot delete your last board', () => {
    renderSettings({ canDelete: false });

    expect(screen.getByRole('button', { name: 'Delete board' })).toBeDisabled();
    expect(screen.getByText("This is your only board, so it can't be deleted.")).toBeInTheDocument();
  });
});
