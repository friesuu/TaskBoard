import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BoardProjectForm from './BoardProjectForm';
import { setBoardProject } from '../api';

vi.mock('../api');

describe('BoardProjectForm', () => {
  beforeEach(() => {
    vi.mocked(setBoardProject).mockReset();
  });

  it("saves the board's project and tells App", async () => {
    vi.mocked(setBoardProject).mockResolvedValue({ id: 3, name: 'Work', project: 'notes-app' });
    const onSaved = vi.fn();
    render(<BoardProjectForm board={{ id: 3, name: 'Work', project: null }} onSaved={onSaved} onSessionEnded={() => false} />);

    await userEvent.type(screen.getByLabelText('Project name'), 'notes-app');
    await userEvent.click(screen.getByRole('button', { name: 'Save project' }));

    expect(setBoardProject).toHaveBeenCalledWith(3, 'notes-app');
    expect(onSaved).toHaveBeenCalledWith({ id: 3, name: 'Work', project: 'notes-app' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it("shows the server's message for a name that isn't allowed", async () => {
    vi.mocked(setBoardProject).mockRejectedValue(new Error('Use a project name from the runner, e.g. "notes-app"'));
    render(<BoardProjectForm board={{ id: 3, name: 'Work', project: null }} onSaved={vi.fn()} onSessionEnded={() => false} />);

    await userEvent.type(screen.getByLabelText('Project name'), '../etc');
    await userEvent.click(screen.getByRole('button', { name: 'Save project' }));

    expect(await screen.findByText(/Use a project name from the runner/)).toBeInTheDocument();
  });
});
