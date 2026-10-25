import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Comments from './Comments';
import { getComments, addComment, updateComment, deleteComment } from '../api';

vi.mock('../api');

const ME = 1;
const mine = {
  id: 10, body: 'Started on the intro',
  createdAt: '2026-10-16T02:00:00.000Z', updatedAt: '2026-10-16T02:00:00.000Z',
  author: { id: ME, email: 'me@test.com' },
};
const theirs = {
  id: 11, body: 'Looks good',
  createdAt: '2026-10-16T03:00:00.000Z', updatedAt: '2026-10-16T03:30:00.000Z', // edited later
  author: { id: 2, email: 'sam@test.com' },
};

function renderComments() {
  render(<Comments taskId={5} currentUserId={ME} onSessionEnded={() => false} />);
}

describe('Comments', () => {
  beforeEach(() => {
    vi.mocked(getComments).mockReset().mockResolvedValue([mine, theirs]);
    vi.mocked(addComment).mockReset();
    vi.mocked(updateComment).mockReset();
    vi.mocked(deleteComment).mockReset().mockResolvedValue(undefined);
  });

  it('shows each comment with its author, oldest first', async () => {
    renderComments();

    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('me@test.com');
    expect(items[0]).toHaveTextContent('Started on the intro');
    expect(items[1]).toHaveTextContent('sam@test.com');
    expect(getComments).toHaveBeenCalledWith(5);
  });

  it("shows the author's display name when they have one", async () => {
    vi.mocked(getComments).mockResolvedValue([{ ...theirs, author: { ...theirs.author, displayName: 'Sam Lee' } }]);
    renderComments();

    expect(await screen.findByText('Sam Lee')).toHaveAttribute('title', 'sam@test.com');
    expect(screen.queryByText('sam@test.com')).not.toBeInTheDocument();
  });

  it('marks an edited comment', async () => {
    renderComments();

    const [first, second] = await screen.findAllByRole('listitem');
    expect(first).not.toHaveTextContent('(edited)');
    expect(second).toHaveTextContent('(edited)');
  });

  it('only shows Edit and Delete on your own comments', async () => {
    renderComments();

    const [first, second] = await screen.findAllByRole('listitem');
    expect(within(first).getByRole('button', { name: 'Edit comment' })).toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: 'Edit comment' })).not.toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: 'Delete comment' })).not.toBeInTheDocument();
  });

  it('adds a comment at the bottom', async () => {
    vi.mocked(addComment).mockResolvedValue({ ...mine, id: 12, body: 'Done with the intro' });
    renderComments();
    await screen.findByText('Looks good');

    await userEvent.type(screen.getByLabelText('New comment'), 'Done with the intro');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(addComment).toHaveBeenCalledWith(5, 'Done with the intro');
    const items = await screen.findAllByRole('listitem');
    expect(items.at(-1)).toHaveTextContent('Done with the intro');
    expect(screen.getByLabelText('New comment')).toHaveValue('');
  });

  it('edits your own comment', async () => {
    vi.mocked(updateComment).mockResolvedValue({ ...mine, body: 'Started on the summary', updatedAt: '2026-10-16T04:00:00.000Z' });
    renderComments();

    await userEvent.click(await screen.findByRole('button', { name: 'Edit comment' }));
    const box = screen.getByLabelText('Edit comment');
    await userEvent.clear(box);
    await userEvent.type(box, 'Started on the summary');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateComment).toHaveBeenCalledWith(10, 'Started on the summary');
    expect(await screen.findByText('Started on the summary')).toBeInTheDocument();
  });

  it('deletes your own comment after you confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderComments();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete comment' }));

    expect(deleteComment).toHaveBeenCalledWith(10);
    expect(screen.queryByText('Started on the intro')).not.toBeInTheDocument();
  });

  it('shows the server message when adding fails', async () => {
    vi.mocked(addComment).mockRejectedValue(new Error('body must be shorter than or equal to 2000 characters'));
    renderComments();
    await screen.findByText('Looks good');

    await userEvent.type(screen.getByLabelText('New comment'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('body must be shorter than or equal to 2000 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('New comment')).toHaveValue('x'); // your text is kept
  });
});
