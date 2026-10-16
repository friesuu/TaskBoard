import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from './Sidebar';

// Every "on..." prop as a fake function, so the tests can check which one a click calls
function renderSidebar(props = {}) {
  const handlers = {
    onClose: vi.fn(),
    onBoard: vi.fn(),
    onProfile: vi.fn(),
    onChat: vi.fn(),
    onChangePassword: vi.fn(),
    onLogout: vi.fn(),
  };
  render(<Sidebar isOpen email="me@test.com" currentView="board" {...handlers} {...props} />);
  return handlers;
}

describe('Sidebar', () => {
  it('shows who is logged in', () => {
    renderSidebar();
    expect(screen.getByText('me@test.com')).toBeInTheDocument();
  });

  it('highlights the page you are on', () => {
    renderSidebar({ currentView: 'profile' });
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Board' })).not.toHaveAttribute('aria-current');
  });

  it('each option calls the right function in App', async () => {
    const handlers = renderSidebar();

    await userEvent.click(screen.getByRole('button', { name: 'Board' }));
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(handlers.onBoard).toHaveBeenCalledOnce();
    expect(handlers.onProfile).toHaveBeenCalledOnce();
    expect(handlers.onChat).toHaveBeenCalledOnce();
    expect(handlers.onChangePassword).toHaveBeenCalledOnce();
    expect(handlers.onLogout).toHaveBeenCalledOnce();
  });

  it('closes with the Escape key and the ✕ button', async () => {
    const { onClose } = renderSidebar();

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves keyboard focus into the menu when it opens', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();
  });

  it('can not be reached while closed (inert)', () => {
    renderSidebar({ isOpen: false });
    expect(screen.getByRole('complementary', { name: 'Menu', hidden: true })).toHaveAttribute('inert');
  });
});
