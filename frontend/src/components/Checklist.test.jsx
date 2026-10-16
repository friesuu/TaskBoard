import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Checklist from './Checklist';
import { getChecklist, addChecklistItem, updateChecklistItem, moveChecklistItem, deleteChecklistItem } from '../api';

vi.mock('../api');

const items = [
  { id: 1, text: 'Book the room', done: true, position: 0 },
  { id: 2, text: 'Order cake', done: false, position: 1 },
];

function renderChecklist() {
  const props = { onProgress: vi.fn(), onSessionEnded: vi.fn(() => false) };
  render(<Checklist taskId={5} {...props} />);
  return props;
}

describe('Checklist', () => {
  beforeEach(() => {
    vi.mocked(getChecklist).mockReset().mockResolvedValue(items);
    vi.mocked(addChecklistItem).mockReset();
    vi.mocked(updateChecklistItem).mockReset().mockResolvedValue({});
    vi.mocked(moveChecklistItem).mockReset();
    vi.mocked(deleteChecklistItem).mockReset().mockResolvedValue(undefined);
  });

  it('shows the items, ticked ones ticked, and the progress', async () => {
    renderChecklist();

    expect(await screen.findByRole('checkbox', { name: 'Book the room' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Order cake' })).not.toBeChecked();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(getChecklist).toHaveBeenCalledWith(5);
  });

  it('adds an item at the bottom and reports the new progress', async () => {
    vi.mocked(addChecklistItem).mockResolvedValue({ id: 3, text: 'Send invites', done: false, position: 2 });
    const { onProgress } = renderChecklist();
    await screen.findByText('Order cake');

    await userEvent.type(screen.getByLabelText('New checklist item'), 'Send invites');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(addChecklistItem).toHaveBeenCalledWith(5, 'Send invites');
    expect(await screen.findByRole('checkbox', { name: 'Send invites' })).toBeInTheDocument();
    expect(onProgress).toHaveBeenLastCalledWith(1, 3);
    expect(screen.getByLabelText('New checklist item')).toHaveValue('');
  });

  it('ticks an item straight away and saves it', async () => {
    const { onProgress } = renderChecklist();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Order cake' }));

    expect(screen.getByRole('checkbox', { name: 'Order cake' })).toBeChecked();
    expect(updateChecklistItem).toHaveBeenCalledWith(2, { done: true });
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it('unticks it again if saving fails, and says why', async () => {
    vi.mocked(updateChecklistItem).mockRejectedValue(new Error('Server is down'));
    const { onProgress } = renderChecklist();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Order cake' }));

    expect(await screen.findByText('Server is down')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Order cake' })).not.toBeChecked();
    expect(onProgress).toHaveBeenLastCalledWith(1, 2); // back to how it was
  });

  it('moves an item up and shows the order the server sends back', async () => {
    vi.mocked(moveChecklistItem).mockResolvedValue([items[1], items[0]]);
    renderChecklist();

    await userEvent.click(await screen.findByRole('button', { name: 'Move "Order cake" up' }));

    expect(moveChecklistItem).toHaveBeenCalledWith(2, 0);
    const texts = screen.getAllByRole('checkbox').map((box) => box.closest('label').textContent);
    expect(texts).toEqual(['Order cake', 'Book the room']);
  });

  it("can't move the top item up or the bottom item down", async () => {
    renderChecklist();

    expect(await screen.findByRole('button', { name: 'Move "Book the room" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move "Order cake" down' })).toBeDisabled();
  });

  it('deletes an item', async () => {
    const { onProgress } = renderChecklist();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete "Book the room"' }));

    expect(deleteChecklistItem).toHaveBeenCalledWith(1);
    expect(screen.queryByText('Book the room')).not.toBeInTheDocument();
    expect(onProgress).toHaveBeenLastCalledWith(0, 1);
  });

  it('hands an expired login to App instead of showing it', async () => {
    const expired = Object.assign(new Error('Unauthorized'), { code: 'UNAUTHENTICATED' });
    vi.mocked(getChecklist).mockRejectedValue(expired);
    const onSessionEnded = vi.fn(() => true);
    render(<Checklist taskId={5} onProgress={vi.fn()} onSessionEnded={onSessionEnded} />);

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledWith(expired));
    expect(screen.queryByText('Unauthorized')).not.toBeInTheDocument();
  });
});
