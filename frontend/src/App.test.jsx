import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { getCurrentUser, getTasks, logout, getBoards, createBoard } from './api';

vi.mock('./api'); // the whole backend is faked: each test decides what the "server" answers

const user = { id: 1, email: 'me@test.com' };
const tasks = [
  { id: 1, title: 'Write report', description: null, status: 'TODO', dueDate: null },
  { id: 2, title: 'Fix login', description: null, status: 'DONE', dueDate: null },
];
const boards = [
  { id: 10, name: 'My board' },
  { id: 20, name: 'Work' },
];
const workTasks = [{ id: 3, title: 'Send invoice', description: null, status: 'TODO', dueDate: null }];

describe('App', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(getTasks).mockReset().mockImplementation(async (boardId) => (boardId === 20 ? workTasks : tasks));
    vi.mocked(logout).mockReset().mockResolvedValue(undefined);
    vi.mocked(getBoards).mockReset().mockResolvedValue(boards);
    vi.mocked(createBoard).mockReset();
    window.history.replaceState(null, '', '/'); // every test starts without ?board=
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
    vi.mocked(getTasks).mockReset().mockResolvedValue([{ ...tasks[0], title: 'Write report (moved)' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(await screen.findByText('Write report (moved)')).toBeInTheDocument();
    expect(vi.mocked(getTasks).mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it('opens your first board and puts it in the address bar', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);

    expect(await screen.findByText('Write report')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My board' })).toBeInTheDocument();
    expect(getTasks).toHaveBeenCalledWith(10);
    expect(window.location.search).toBe('?board=10');
  });

  it('opens the board in the address bar after a refresh', async () => {
    window.history.replaceState(null, '', '/?board=20');
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);

    expect(await screen.findByText('Send invoice')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument();
  });

  it("ignores a board in the address bar that isn't yours", async () => {
    window.history.replaceState(null, '', '/?board=999');
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);

    expect(await screen.findByText('Write report')).toBeInTheDocument();
    expect(getTasks).not.toHaveBeenCalledWith(999); // never asks for it
    expect(window.location.search).toBe('?board=10');
  });

  it('switches boards from the menu', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Work' }));

    expect(await screen.findByText('Send invoice')).toBeInTheDocument();
    expect(screen.queryByText('Write report')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?board=20');
  });

  it('creates a board from the menu and opens it', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(createBoard).mockResolvedValue({ id: 30, name: 'Holiday' });
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'New board' }));
    await userEvent.type(screen.getByLabelText('Board name'), 'Holiday');
    await userEvent.click(screen.getByRole('button', { name: 'Create board' }));

    expect(createBoard).toHaveBeenCalledWith('Holiday');
    expect(await screen.findByRole('heading', { name: 'Holiday' })).toBeInTheDocument();
    expect(getTasks).toHaveBeenCalledWith(30);
  });

  it('forgets the open board when you log out', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('heading', { name: 'Log in' });
    expect(window.location.search).toBe(''); // the next person starts on their own first board
  });

  it('shows the error instead of loading forever when the server is down', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Failed to fetch'));
    render(<App />);

    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
  });
});
