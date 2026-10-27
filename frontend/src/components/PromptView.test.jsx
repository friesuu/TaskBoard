import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptView from './PromptView';

const PROMPT = `## Goal
Add a **search box** to \`Board.jsx\`.

## Changes
- Backend:
  - add a \`q\` filter
- Frontend: a box above the columns

\`\`\`
npm run test:e2e
\`\`\`

## Questions
Which page? [[FILL IN: which page?]]`;

describe('PromptView', () => {
  it('shows headings, bold, code, lists and code blocks', () => {
    render(<PromptView text={PROMPT} />);

    expect(screen.getByRole('heading', { name: 'Goal' })).toBeInTheDocument();
    expect(screen.getByText('search box').tagName).toBe('STRONG');
    expect(screen.getByText('Board.jsx').tagName).toBe('CODE');
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Backend:', 'add a q filter', 'Frontend: a box above the columns']);
    expect(items[1]).toHaveClass('depth-1');
    expect(screen.getByText('npm run test:e2e').tagName).toBe('PRE');
  });

  it('highlights blanks, and says which one was clicked', async () => {
    const onBlankClick = vi.fn();
    render(<PromptView text={PROMPT} onBlankClick={onBlankClick} />);

    await userEvent.click(screen.getByRole('button', { name: '[[FILL IN: which page?]]' }));
    expect(onBlankClick).toHaveBeenCalledWith(0);
  });

  it('never runs the prompt as HTML', () => {
    const { container } = render(<PromptView text={'<img src=x onerror="alert(1)"> hi'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)"> hi')).toBeInTheDocument();
  });
});
