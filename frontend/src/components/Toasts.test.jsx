import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toasts from './Toasts';

const failure = (n) => ({ id: `f${n}`, tone: 'danger', text: `Run failed ${n}`, task: null });

describe('Toasts', () => {
  afterEach(() => vi.useRealTimers());

  it('shows at most 3 at once: the next one waits until one goes', async () => {
    const onDismiss = vi.fn();
    const toasts = [1, 2, 3, 4].map(failure);
    const { rerender } = render(<Toasts toasts={toasts} onDismiss={onDismiss} onView={vi.fn()} />);

    expect(screen.getAllByText(/Run failed/)).toHaveLength(3);
    expect(screen.queryByText('Run failed 4')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    expect(onDismiss).toHaveBeenCalledWith('f1');
    rerender(<Toasts toasts={toasts.slice(1)} onDismiss={onDismiss} onView={vi.fn()} />);
    expect(screen.getByText('Run failed 4')).toBeInTheDocument();
  });

  it('success and info go by themselves after 5 seconds; a failure stays until you close it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toasts
        toasts={[{ id: 'ok', tone: 'success', text: 'Ready for review: #7 Add search', task: { id: 7 } }, failure(1)]}
        onDismiss={onDismiss}
        onView={vi.fn()}
      />,
    );

    act(() => vi.advanceTimersByTime(5000));
    expect(onDismiss).toHaveBeenCalledWith('ok');
    expect(onDismiss).not.toHaveBeenCalledWith('f1');
  });

  it('is read out by screen readers, never takes the focus, and View opens the task', async () => {
    const onView = vi.fn();
    const toast = { id: 'p', tone: 'prompt', text: 'Prompt ready for approval: #7 Add search', task: { id: 7 } };
    const { container } = render(<Toasts toasts={[toast]} onDismiss={vi.fn()} onView={onView} />);

    expect(container.querySelector('.toasts')).toHaveAttribute('aria-live', 'polite');
    expect(document.activeElement).toBe(document.body);
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onView).toHaveBeenCalledWith(toast);
  });
});
