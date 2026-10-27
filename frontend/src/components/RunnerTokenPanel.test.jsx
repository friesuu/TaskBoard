import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RunnerTokenPanel from './RunnerTokenPanel';
import { createRunnerToken, getRunnerToken, revokeRunnerToken } from '../api';

vi.mock('../api');

const INFO = { createdAt: '2026-10-27T01:00:00.000Z', lastUsedAt: null };

describe('RunnerTokenPanel', () => {
  beforeEach(() => {
    vi.mocked(getRunnerToken).mockReset().mockResolvedValue(null);
    vi.mocked(createRunnerToken).mockReset().mockResolvedValue('tbr_secret-value');
    vi.mocked(revokeRunnerToken).mockReset().mockResolvedValue(undefined);
  });

  it('creates a token and shows it once, with where to put it', async () => {
    render(<RunnerTokenPanel onSessionEnded={() => false} />);
    expect(await screen.findByText('No token yet.')).toBeInTheDocument();

    vi.mocked(getRunnerToken).mockResolvedValue(INFO);
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByText('tbr_secret-value')).toBeInTheDocument();
    expect(screen.getByText(/RUNNER_TOKEN in ~\/task-board\/runner\/.env/)).toBeInTheDocument();
    expect(screen.getByText(/not used yet/)).toBeInTheDocument();
  });

  it('revokes the token only after you confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(getRunnerToken).mockResolvedValue(INFO);
    render(<RunnerTokenPanel onSessionEnded={() => false} />);

    const revoke = await screen.findByRole('button', { name: 'Revoke token' });
    await userEvent.click(revoke); // Cancel
    expect(revokeRunnerToken).not.toHaveBeenCalled();

    await userEvent.click(revoke); // OK
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(revokeRunnerToken).toHaveBeenCalledOnce();
    expect(await screen.findByText('No token yet.')).toBeInTheDocument();
  });
});
