import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewSwitch from './ViewSwitch';

describe('ViewSwitch', () => {
  it('shows which view is on', () => {
    render(<ViewSwitch view="calendar" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('asks App to switch', async () => {
    const onChange = vi.fn();
    render(<ViewSwitch view="board" onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));

    expect(onChange).toHaveBeenCalledWith('calendar');
  });
});
