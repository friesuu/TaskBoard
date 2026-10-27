import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import {
  getCurrentUser, getTasks, logout, getBoards, createBoard, getChecklist, getComments, getLabels, setTaskLabels,
  setTimeZone, getAttachments, updateChecklistItem,
  getTaskStats, getAgentStatus, getNotifications, markNotificationRead, getAiRuns,
} from './api';

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
    vi.mocked(getChecklist).mockReset().mockResolvedValue([]);
    vi.mocked(getComments).mockReset().mockResolvedValue([]);
    vi.mocked(getLabels).mockReset().mockResolvedValue([{ id: 7, name: 'Urgent', color: 'ORANGE' }]);
    vi.mocked(setTaskLabels).mockReset();
    vi.mocked(setTimeZone).mockReset().mockResolvedValue(undefined);
    vi.mocked(getAgentStatus).mockReset().mockResolvedValue({ state: 'never', task: null, step: null });
    vi.mocked(getNotifications).mockReset().mockResolvedValue({ notifications: [], unreadCount: 0 });
    vi.mocked(markNotificationRead).mockReset().mockResolvedValue(undefined);
    vi.mocked(getAiRuns).mockReset().mockResolvedValue([]);
    localStorage.clear();
    vi.mocked(getTaskStats).mockReset().mockResolvedValue(
      { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0, dueThisWeek: 0, doneThisWeek: 0 },
    );
    vi.mocked(getAttachments).mockReset().mockResolvedValue([]);
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
    // The page title is the open board; the app's name is in the navigation
    expect(await screen.findByRole('heading', { name: 'My board' })).toBeInTheDocument();
    expect(screen.getByText('Task Board')).toBeInTheDocument();
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
    expect(getTasks).toHaveBeenCalledWith(10, null); // null = no filters
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
    expect(getTasks).not.toHaveBeenCalledWith(999, null); // never asks for it
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
    expect(getTasks).toHaveBeenCalledWith(30, null);
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

  it("opens a task's details from its card, and closes them again", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);

    // The title button inside the card's heading (the card around it is a drag handle with the same name)
    const heading = await screen.findByRole('heading', { name: 'Write report' });
    await userEvent.click(within(heading).getByRole('button'));

    expect(screen.getByRole('dialog', { name: 'Write report' })).toBeInTheDocument();
    expect(getChecklist).toHaveBeenCalledWith(1);
    expect(getComments).toHaveBeenCalledWith(1);

    await userEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("Board settings lists the open board's labels", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.click(screen.getByRole('button', { name: 'Board settings' }));

    expect(getLabels).toHaveBeenCalledWith(10);
    expect(screen.getByRole('button', { name: 'Edit label "Urgent"' })).toBeInTheDocument();
  });

  it('a label picked in the task panel shows on the card', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(setTaskLabels).mockResolvedValue({ ...tasks[0], labels: [{ id: 7, name: 'Urgent', color: 'ORANGE' }] });
    render(<App />);

    const heading = await screen.findByRole('heading', { name: 'Write report' });
    await userEvent.click(within(heading).getByRole('button'));
    await userEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close task' }));

    expect(setTaskLabels).toHaveBeenCalledWith(1, [7]);
    expect(await screen.findByText('Urgent')).toBeInTheDocument(); // on the card now
  });

  it('tells the server the browser time zone after logging in', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ ...user, timeZone: null });
    render(<App />);
    await screen.findByText('Write report');

    expect(setTimeZone).toHaveBeenCalledWith(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("doesn't overwrite a time zone you've already saved", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ ...user, timeZone: 'Pacific/Auckland' });
    render(<App />);
    await screen.findByText('Write report');

    expect(setTimeZone).not.toHaveBeenCalled();
  });

  it('opens with the filters in the address bar, showing only the chosen columns', async () => {
    window.history.replaceState(null, '', '/?q=report&status=TODO');
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    expect(getTasks).toHaveBeenCalledWith(10, { q: 'report', statuses: ['TODO'] });
    expect(screen.getByRole('heading', { name: /^To do/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Done/ })).not.toBeInTheDocument();
  });

  it('searching from the filter bar reloads the board and updates the address bar', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.type(screen.getByLabelText('Search tasks'), 'report');

    await vi.waitFor(() => expect(getTasks).toHaveBeenCalledWith(10, { q: 'report' }));
    expect(window.location.search).toBe('?board=10&q=report');
    expect(screen.getByText("Filters are on, so cards can't be dragged. Clear them to reorder.")).toBeInTheDocument();
  });

  it('remembers the page you are on in the address bar', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));

    expect(window.location.search).toBe('?board=10&view=profile');
  });

  it('opens the calendar from the address bar, with the undated tasks beside it', async () => {
    window.history.replaceState(null, '', '/?view=calendar');
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);

    const undated = await screen.findByRole('region', { name: 'No due date' });
    expect(await within(undated).findByRole('button', { name: 'Write report' })).toBeInTheDocument(); // once loaded
    const viewSwitch = screen.getByRole('group', { name: 'View' });
    expect(within(viewSwitch).getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches between the board and the calendar', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    render(<App />);
    await screen.findByText('Write report');

    // The switch's "Board" (the menu has a "Board" page too)
    const viewSwitch = screen.getByRole('group', { name: 'View' });
    await userEvent.click(within(viewSwitch).getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('region', { name: 'No due date' })).toBeInTheDocument();
    expect(window.location.search).toBe('?board=10&view=calendar');

    await userEvent.click(within(viewSwitch).getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('heading', { name: /^To do/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'No due date' })).not.toBeInTheDocument();
  });

  it('ticking an item on a card updates its count', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(getTasks).mockReset().mockResolvedValue([{ ...tasks[0], checklistDone: 0, checklistTotal: 1 }]);
    vi.mocked(getChecklist).mockResolvedValue([{ id: 9, text: 'Outline', done: false, position: 0 }]);
    vi.mocked(updateChecklistItem).mockResolvedValue({});
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Checklist, 0 of 1 done' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Outline' }));

    expect(await screen.findByRole('button', { name: 'Checklist, 1 of 1 done' })).toBeInTheDocument();
  });

  describe('keyboard shortcuts', () => {
    const renderBoard = async () => {
      vi.mocked(getCurrentUser).mockResolvedValue(user);
      render(<App />);
      await screen.findByText('Write report');
    };

    it('N opens the Add task form (n or N)', async () => {
      await renderBoard();

      await userEvent.keyboard('n');
      expect(screen.getByRole('heading', { name: 'Add New Task' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));

      await userEvent.keyboard('N'); // Caps Lock or Shift
      expect(screen.getByRole('heading', { name: 'Add New Task' })).toBeInTheDocument();
    });

    it('/ focuses the search box without typing the / into it', async () => {
      await renderBoard();

      await userEvent.keyboard('/');
      const search = screen.getByRole('searchbox', { name: 'Search tasks' });
      expect(search).toHaveFocus();
      expect(search).toHaveValue('');
    });

    it('B and C switch between the board and the calendar', async () => {
      await renderBoard();

      await userEvent.keyboard('c');
      expect(screen.getByRole('region', { name: 'No due date' })).toBeInTheDocument();
      expect(window.location.search).toBe('?board=10&view=calendar');

      await userEvent.keyboard('B');
      expect(screen.getByRole('heading', { name: /^To do/ })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'No due date' })).not.toBeInTheDocument();
    });

    it('? shows the shortcuts help', async () => {
      await renderBoard();

      await userEvent.keyboard('?');
      const help = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
      expect(within(help).getByText('Add a task')).toBeInTheDocument();
      expect(within(help).getByText('/')).toBeInTheDocument();
      expect(within(help).getByText('Calendar view')).toBeInTheDocument();
    });

    it('typing "n" in the search box or a task title opens nothing', async () => {
      await renderBoard();

      const search = screen.getByRole('searchbox', { name: 'Search tasks' });
      await userEvent.type(search, 'n');
      expect(search).toHaveValue('n');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
      const title = screen.getByLabelText('Title *');
      await userEvent.type(title, 'n?/bc');
      expect(title).toHaveValue('n?/bc');
      expect(screen.getAllByRole('dialog')).toHaveLength(1); // still just the Add task form
      expect(screen.getByRole('heading', { name: 'Add New Task' })).toBeInTheDocument();
    });

    it('ignores the keys when Ctrl, Alt or Meta is held', async () => {
      await renderBoard();

      await userEvent.keyboard('{Control>}n{/Control}{Alt>}n{/Alt}{Meta>}c{/Meta}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'No due date' })).not.toBeInTheDocument();
    });

    it('shows the shortcuts in the tooltips', async () => {
      await renderBoard();

      expect(screen.getByRole('button', { name: 'Add task' })).toHaveAttribute('title', 'Add task (N)');
      expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveAttribute('title', 'Search tasks (/)');
      const viewSwitch = screen.getByRole('group', { name: 'View' });
      expect(within(viewSwitch).getByRole('button', { name: 'Board' })).toHaveAttribute('title', 'Board (B)');
      expect(within(viewSwitch).getByRole('button', { name: 'Calendar' })).toHaveAttribute('title', 'Calendar (C)');
    });
  });

  it('shows the error instead of loading forever when the server is down', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('Failed to fetch'));
    render(<App />);

    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
  });

  it("pops up what's new from the runner as a toast, and the bell opens the task on its AI tab", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    localStorage.setItem('taskboard:last-notification:1', '4'); // this browser last saw notification 4
    vi.mocked(getNotifications).mockResolvedValue({
      notifications: [
        {
          id: 5, kind: 'prompt_ready', message: 'Prompt ready for approval', createdAt: new Date().toISOString(), readAt: null,
          task: { id: 1, title: 'Write report', boardId: 10 },
        },
        {
          id: 4, kind: 'review_ready', message: 'Ready for review', createdAt: new Date().toISOString(),
          readAt: '2026-10-27T01:00:00Z', task: { id: 2, title: 'Fix login', boardId: 10 },
        },
      ],
      unreadCount: 1,
    });
    render(<App />);

    expect(await screen.findByText('Prompt ready for approval: #1 Write report')).toBeInTheDocument(); // the toast
    expect(screen.queryByText('Ready for review: #2 Fix login')).not.toBeInTheDocument(); // seen before

    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    const list = screen.getByRole('region', { name: 'Notifications' });
    await userEvent.click(within(list).getByRole('button', { name: /Prompt ready/ }));

    expect(markNotificationRead).toHaveBeenCalledWith(5);
    expect(await screen.findByRole('dialog', { name: 'Write report' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument(); // nothing unread now
  });

  it('has an AI Activity page in the menu', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.mocked(getAgentStatus).mockResolvedValue({ state: 'offline', lastSeenAt: new Date(Date.now() - 3600_000).toISOString() });
    render(<App />);
    await screen.findByText('Write report');

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'AI Activity' }));
    expect(await screen.findByRole('heading', { name: 'AI Activity', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Offline')).toBeInTheDocument();
  });
});
