import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiActivity, { AgentBanner } from './AiActivity';
import { getAiRuns, getRunLog } from '../api';

vi.mock('../api');

const run = (fields = {}) => ({
  id: 1, step: 'build', status: 'succeeded', result: 'built', project: 'task-board', branch: 'ai/task-7-add-search',
  checksPassed: true, costUsd: 0.5, error: null, summary: null,
  startedAt: '2026-10-27T01:00:00Z', finishedAt: '2026-10-27T01:01:22Z',
  task: { id: 7, title: 'Add search', boardId: 2 },
  ...fields,
});

function renderPage(props = {}) {
  const handlers = { onOpenTask: vi.fn(), onRefresh: vi.fn(), onSessionEnded: vi.fn(() => false) };
  render(<AiActivity agentStatus={{ state: 'idle', lastSeenAt: new Date().toISOString() }} {...handlers} {...props} />);
  return handlers;
}

describe('AiActivity', () => {
  beforeEach(() => {
    vi.mocked(getAiRuns).mockReset().mockResolvedValue([]);
    vi.mocked(getRunLog).mockReset().mockResolvedValue([]);
  });

  it('says when nothing has run yet, and when the runner has never checked in', async () => {
    renderPage({ agentStatus: { state: 'never' } });
    expect(await screen.findByText('Nothing has run yet')).toBeInTheDocument();
    expect(screen.getByText('Not connected yet')).toBeInTheDocument();
  });

  it("lists the runs, and opens one's step-by-step log, with a Copy button and a way to its task", async () => {
    vi.mocked(getAiRuns).mockResolvedValue([run()]);
    vi.mocked(getRunLog).mockResolvedValue([{ id: 1, at: '2026-10-27T01:00:05Z', kind: 'tool', text: 'Ran pnpm test' }]);
    const user = userEvent.setup(); // also gives the page a clipboard to copy to
    const { onOpenTask } = renderPage();

    const toggle = await screen.findByRole('button', { name: '#7 Add search' });
    expect(screen.getByText('Built · checks passed')).toBeInTheDocument();
    expect(screen.getByText('1m 22s')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(await screen.findByText('Ran pnpm test')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toContain('Ran pnpm test');

    await user.click(screen.getByRole('button', { name: 'Open task' }));
    expect(onOpenTask).toHaveBeenCalledWith({ id: 7, title: 'Add search', boardId: 2 });
  });

  it('filters by result, and shows a failed run with why', async () => {
    vi.mocked(getAiRuns).mockImplementation(async (status) => (status === 'failed'
      ? [run({ id: 2, status: 'failed', result: 'stopped early', checksPassed: false, error: 'Claude Code used up its steps' })]
      : [run()]));
    renderPage();
    await screen.findByText('Built · checks passed');

    await userEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(getAiRuns).toHaveBeenLastCalledWith('failed');
    const failed = await screen.findByText('Stopped early · checks failed');
    expect(failed.closest('.ai-chip')).toHaveClass('danger');

    await userEvent.click(screen.getByRole('button', { name: '#7 Add search' }));
    expect(screen.getByText('Claude Code used up its steps')).toBeInTheDocument();
  });

  it('Refresh loads the runs and the runner status again', async () => {
    const { onRefresh } = renderPage();
    await screen.findByText('Nothing has run yet');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalled();
    expect(getAiRuns).toHaveBeenCalledTimes(2);
  });
});

describe('AgentBanner', () => {
  it('shows offline calmly, with when it was last seen', () => {
    render(<AgentBanner status={{ state: 'offline', lastSeenAt: new Date(Date.now() - 2 * 3600_000).toISOString() }} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/Last seen 2 h ago/)).toBeInTheDocument();
  });

  it('shows the usage limit, and when it resumes', () => {
    render(<AgentBanner status={{ state: 'paused', pausedUntil: '2026-10-27T15:45:00Z' }} />);
    expect(screen.getByText('Usage limit reached')).toBeInTheDocument();
    expect(screen.getByText(/^Resumes/)).toBeInTheDocument();
  });

  it('shows what the runner is working on, with a pulsing dot', () => {
    const stateSince = new Date(Date.now() - 65_000).toISOString();
    const { container } = render(
      <AgentBanner status={{ state: 'working', step: 'build', task: { id: 7, title: 'Add search' }, stateSince }} />,
    );
    expect(screen.getByText('Working on #7 Add search')).toBeInTheDocument();
    expect(screen.getByText('Building · for 1m 05s')).toBeInTheDocument();
    expect(container.querySelector('.dot')).toHaveClass('pulsing');
  });
});
