import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profile from './Profile';
import { getTaskStats, setDisplayName, setTimeZone, deleteAccount } from '../api';

vi.mock('../api');

const STATS = {
  total: 8, todo: 3, promptReview: 0, inProgress: 2, aiReview: 0, done: 3, overdue: 1, dueThisWeek: 2, doneThisWeek: 1,
};
const user = { id: 1, email: 'sam@test.com', timeZone: 'Asia/Kuala_Lumpur', displayName: null };

function renderProfile(props = {}) {
  const handlers = {
    onBack: vi.fn(),
    onChangePassword: vi.fn(),
    onUserChange: vi.fn(),
    onAccountDeleted: vi.fn(),
    onSessionEnded: vi.fn(() => false),
  };
  render(<Profile user={user} {...handlers} {...props} />);
  return handlers;
}

// A settings row's button: its name is the label followed by the preview, e.g. "Time zone Asia/Kuala_Lumpur"
const row = (label) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

// The number shown under a label, e.g. numberFor('Overdue') -> '1'
const numberFor = (label) => screen.getByText(label).closest('.stat').querySelector('.stat-number').textContent;

describe('Profile', () => {
  beforeEach(() => {
    vi.mocked(getTaskStats).mockReset().mockResolvedValue(STATS);
    vi.mocked(setDisplayName).mockReset();
    vi.mocked(setTimeZone).mockReset().mockResolvedValue(undefined);
    vi.mocked(deleteAccount).mockReset().mockResolvedValue(undefined);
  });

  it('shows your email, or your display name with the email under it', () => {
    renderProfile({ user: { ...user, displayName: 'Lee Sam' } });

    expect(screen.getByRole('heading', { name: 'Lee Sam' })).toBeInTheDocument();
    expect(screen.getByText('sam@test.com')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument(); // the letter avatar
  });

  it('opens "Your tasks" first, with the numbers across all your boards', async () => {
    renderProfile();

    expect(await screen.findByText('3 of 8 done')).toBeInTheDocument();
    expect(row('Your tasks')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Your tasks')).toHaveTextContent('8 tasks · 3 done · 1 overdue');
    expect(screen.getByRole('progressbar', { name: 'Tasks done' })).toHaveAttribute('aria-valuenow', '38');
    expect(numberFor('To do')).toBe('3');
    expect(numberFor('In Progress')).toBe('2');
    expect(numberFor('Done')).toBe('3');
    expect(numberFor('Overdue')).toBe('1');
    expect(numberFor('Due this week')).toBe('2');
    expect(numberFor('Finished this week')).toBe('1');
  });

  it('rows open like a dropdown, one at a time', async () => {
    renderProfile();
    await screen.findByText('3 of 8 done');

    await userEvent.click(row('Display name'));
    expect(row('Display name')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Your tasks')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('3 of 8 done')).not.toBeInTheDocument();

    await userEvent.click(row('Display name')); // and closes again
    expect(row('Display name')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Display name' })).not.toBeInTheDocument();
  });

  it('saves a display name and tells App', async () => {
    vi.mocked(setDisplayName).mockResolvedValue('Lee Sam');
    const { onUserChange } = renderProfile();

    await userEvent.click(row('Display name'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Display name' }), 'Lee Sam');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(setDisplayName).toHaveBeenCalledWith('Lee Sam');
    expect(onUserChange).toHaveBeenCalledWith({ displayName: 'Lee Sam' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('saves a time zone and tells App', async () => {
    const { onUserChange } = renderProfile();

    await userEvent.click(row('Time zone'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Time zone' }), 'Europe/London');
    await userEvent.click(screen.getByRole('button', { name: 'Save time zone' }));

    expect(setTimeZone).toHaveBeenCalledWith('Europe/London');
    expect(onUserChange).toHaveBeenCalledWith({ timeZone: 'Europe/London' });
  });

  it('deletes the account only with the password and after you confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { onAccountDeleted } = renderProfile();
    await userEvent.click(row('Delete account'));
    const deleteButton = screen.getByRole('button', { name: 'Delete my account' });

    await userEvent.click(deleteButton); // no password yet
    expect(screen.getByText('Enter your password first')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Your password'), 'my-password');
    await userEvent.click(deleteButton); // Cancel
    expect(deleteAccount).not.toHaveBeenCalled();

    await userEvent.click(deleteButton); // OK
    expect(confirm).toHaveBeenCalledWith("Delete your account and everything in it? This can't be undone.");
    expect(deleteAccount).toHaveBeenCalledWith('my-password');
    expect(onAccountDeleted).toHaveBeenCalledOnce();
  });

  it("shows the server's message when the password is wrong, and keeps you here", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(deleteAccount).mockRejectedValue(new Error('Password is incorrect'));
    const { onAccountDeleted } = renderProfile();

    await userEvent.click(row('Delete account'));
    await userEvent.type(screen.getByLabelText('Your password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByText('Password is incorrect')).toBeInTheDocument();
    expect(onAccountDeleted).not.toHaveBeenCalled();
  });

  it('has working Back and Change password buttons', async () => {
    const { onBack, onChangePassword } = renderProfile();

    await userEvent.click(screen.getByRole('button', { name: 'Back to board' }));
    await userEvent.click(row('Password'));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onChangePassword).toHaveBeenCalledOnce();
  });
});
