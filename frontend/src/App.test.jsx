import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { getCurrentUser, getTasks, logout } from './api';

vi.mock('./api'); // the whole backend is faked: each test decides what the "server" answers

const user = { id: 1, email: 'me@test.com' };
const tasks = [
  { id: 1, title: 'Write report', description: null, status: 'TODO', dueDate: null },
  { id: 2, title: 'Fix login', description: null, status: 'DONE', dueDate: null },
];

describe('App', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(getTasks).mockReset().mockResolvedValue(tasks);
    vi.mocked(logout).mockReset().mockResolvedValue(undefined);
  });

  it('shows the login form when nobody is logged in', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(getTasks).not.toHaveBeenCalled(); // no tasks are loaded for nobody
  });

  it("shows the logged-in user's board", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);

    expect(await screen.findByText('Write report')).toBeInTheDocument();
    expect(screen.getByText('Fix login')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Task Board' })).toBeInTheDocument();
  });

  it('goes back to the login form when the session has expired', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(getTasks).mockRejectedValue(Object.assign(new Error('Unauthorized'), { code: 'UNAUTHENTICATED' }));
    render(<App />);

    expect(await screen.findByText('Your session has expired. Please log in again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('logs out from the menu and empties the board', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByText('Write report')).not.toBeInTheDocument(); // the next person can't see it
  });

  it('asks the server who is logged in only once (no endless requests)', async () => {
    // Like the real server: every answer is a NEW object
    vi.mocked(getCurrentUser).mockImplementation(async () => ({ ...user }));
    render(<App />);
    await screen.findByText('Write report');

    await new Promise((resolve) => setTimeout(resolve, 200)); // give a loop time to show itself
    expect(getCurrentUser).toHaveBeenCalledOnce();
  });

  it('reloads the tasks when you switch pages, so the assistant\'s changes show up', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');
    const loadsBefore = vi.mocked(getTasks).mock.calls.length;

    // Meanwhile the assistant moved a task on the server
    vi.mocked(getTasks).mockResolvedValue([{ ...tasks[0], title: 'Write report (moved)' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(await screen.findByText('Write report (moved)')).toBeInTheDocument();
    expect(vi.mocked(getTasks).mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it('shows the error instead of loading forever when the server is down', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Failed to fetch'));
    render(<App />);

    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
  });
});
