import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from './NotificationBell';

const failed = {
  id: 3, kind: 'run_failed', message: 'Claude stopped: The spend cap was reached', createdAt: new Date().toISOString(),
  readAt: null, task: { id: 7, title: 'Add search', boardId: 2 },
};
const ready = {
  id: 2, kind: 'review_ready', message: 'Ready for review', createdAt: new Date().toISOString(),
  readAt: '2026-10-27T01:00:00Z', task: { id: 8, title: 'Add shortcuts', boardId: 2 },
};

function renderBell(props = {}) {
  const handlers = { onOpen: vi.fn(), onOpenNotification: vi.fn(), onMarkAllRead: vi.fn() };
  render(<NotificationBell notifications={[failed, ready]} unreadCount={1} {...handlers} {...props} />);
  return handlers;
}

describe('NotificationBell', () => {
  it('shows how many are unread, and the list when opened', async () => {
    const { onOpen, onOpenNotification } = renderBell();
    const bell = screen.getByRole('button', { name: 'Notifications, 1 unread' });

    await userEvent.click(bell);
    expect(onOpen).toHaveBeenCalled(); // App checks for new ones
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('#7 Add search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unread: Claude stopped: The spend cap was reached, #7 Add search, just now' }))
      .toHaveClass('unread');
    expect(screen.getByRole('button', { name: 'Ready for review, #8 Add shortcuts, just now' })).not.toHaveClass('unread');

    await userEvent.click(screen.getByRole('button', { name: /Claude stopped/ }));
    expect(onOpenNotification).toHaveBeenCalledWith(failed);
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('marks them all read, and closes with Escape', async () => {
    const { onMarkAllRead } = renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(onMarkAllRead).toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it("says when you're all caught up", async () => {
    renderBell({ notifications: [], unreadCount: 0 });
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });
});
