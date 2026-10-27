import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AiRunLog from './AiRunLog';
import { getAgentRuns } from '../api';

vi.mock('../api');

const runs = [
  {
    id: 2, step: 'build', result: 'built', branch: 'ai/task-5-add-search', checksPassed: true, costUsd: 0.067,
    error: null, startedAt: '2026-10-27T02:07:30.000Z', finishedAt: '2026-10-27T02:07:50.000Z',
  },
  {
    id: 1, step: 'refine', result: 'stopped', branch: null, checksPassed: null, costUsd: 0.5,
    error: 'The spend cap for this step was reached', startedAt: '2026-10-27T02:05:00.000Z', finishedAt: '2026-10-27T02:05:19.000Z',
  },
];

// Opening a <details> element: set it open and fire its "toggle" event, as the browser does
function open(container)
{
  const details = container.querySelector('details');
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('AiRunLog', () => {
  beforeEach(() => {
    vi.mocked(getAgentRuns).mockReset().mockResolvedValue(runs);
  });

  it("loads only when opened, then lists each step's result and cost", async () => {
    const { container } = render(<AiRunLog taskId={5} onSessionEnded={() => false} />);
    expect(getAgentRuns).not.toHaveBeenCalled();

    open(container);

    expect(await screen.findByText('Built it')).toBeInTheDocument();
    expect(getAgentRuns).toHaveBeenCalledWith(5);
    expect(screen.getByText(/built · checks passed/)).toBeInTheDocument();
    expect(screen.getByText('$0.07')).toBeInTheDocument();
    expect(screen.getByText('ai/task-5-add-search')).toBeInTheDocument();
    expect(screen.getByText('The spend cap for this step was reached')).toBeInTheDocument();
  });

  it('says so when there are no runs yet', async () => {
    vi.mocked(getAgentRuns).mockResolvedValue([]);
    const { container } = render(<AiRunLog taskId={5} onSessionEnded={() => false} />);

    open(container);

    expect(await screen.findByText('No runs yet.')).toBeInTheDocument();
  });
});
