import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Profile from './Profile';

// The number shown above a label, e.g. numberFor('Total') -> '4'
const numberFor = (label) => screen.getByText(label).closest('.stat').querySelector('.stat-number').textContent;

const tasks = [
  { id: 1, title: 'A', status: 'TODO', dueDate: '2000-01-01' }, // long overdue
  { id: 2, title: 'B', status: 'TODO', dueDate: null },
  { id: 3, title: 'C', status: 'IN_PROGRESS', dueDate: null },
  { id: 4, title: 'D', status: 'DONE', dueDate: '2000-01-01' }, // done, so not overdue
];

describe('Profile', () => {
  it('shows the email and a letter avatar', () => {
    render(<Profile user={{ email: 'sam@test.com' }} tasks={[]} onBack={vi.fn()} onChangePassword={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'sam@test.com' })).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('counts the tasks per column and the overdue ones', () => {
    render(<Profile user={{ email: 'sam@test.com' }} tasks={tasks} onBack={vi.fn()} onChangePassword={vi.fn()} />);

    expect(numberFor('Total')).toBe('4');
    expect(numberFor('To do')).toBe('2');
    expect(numberFor('In Progress')).toBe('1');
    expect(numberFor('Done')).toBe('1');
    expect(numberFor('Overdue')).toBe('1');
  });

  it('has working Back and Change password buttons', async () => {
    const onBack = vi.fn();
    const onChangePassword = vi.fn();
    render(<Profile user={{ email: 'sam@test.com' }} tasks={[]} onBack={onBack} onChangePassword={onChangePassword} />);

    await userEvent.click(screen.getByRole('button', { name: 'Back to board' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onChangePassword).toHaveBeenCalledOnce();
  });
});
