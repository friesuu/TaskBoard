import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginForm from './LoginForm';
import { login, register } from '../api';

vi.mock('../api'); // every function in api.js becomes a fake we control: no server, no network

const user = { id: 1, email: 'me@test.com' };

// Fill in the form the way a person would
async function fillIn(email, password) {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.mocked(login).mockReset();
    vi.mocked(register).mockReset();
  });

  it('logs in and tells App who logged in', async () => {
    vi.mocked(login).mockResolvedValue(user);
    const onLoggedIn = vi.fn();
    render(<LoginForm onLoggedIn={onLoggedIn} />);

    await fillIn('me@test.com', 'my-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(login).toHaveBeenCalledWith('me@test.com', 'my-password');
    expect(register).not.toHaveBeenCalled();
    expect(onLoggedIn).toHaveBeenCalledWith(user);
  });

  it('in register mode, creates the account and then logs in', async () => {
    vi.mocked(register).mockResolvedValue(user);
    vi.mocked(login).mockResolvedValue(user);
    const onLoggedIn = vi.fn();
    render(<LoginForm onLoggedIn={onLoggedIn} />);

    await userEvent.click(screen.getByRole('button', { name: 'No account? Register' }));
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();

    await fillIn('new@test.com', 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(register).toHaveBeenCalledWith('new@test.com', 'new-password');
    expect(login).toHaveBeenCalledWith('new@test.com', 'new-password');
    expect(onLoggedIn).toHaveBeenCalledWith(user);
  });

  it("shows the server's error and doesn't log in", async () => {
    vi.mocked(login).mockRejectedValue(new Error('Invalid email or password'));
    const onLoggedIn = vi.fn();
    render(<LoginForm onLoggedIn={onLoggedIn} />);

    await fillIn('me@test.com', 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(onLoggedIn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(); // can try again
  });

  it("shows App's notice, e.g. an expired session", () => {
    render(<LoginForm onLoggedIn={vi.fn()} notice="Your session has expired. Please log in again." />);
    expect(screen.getByText('Your session has expired. Please log in again.')).toBeInTheDocument();
  });

  it('hides the password as you type', () => {
    render(<LoginForm onLoggedIn={vi.fn()} />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
});
