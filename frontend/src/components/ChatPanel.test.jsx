import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatPanel from './ChatPanel';
import { getChatMessages, sendChatMessage, clearChat } from '../api';

vi.mock('../api'); // no server and no Claude: the tests decide every answer

const saved = [
  { id: 1, role: 'user', content: 'Hi' },
  { id: 2, role: 'assistant', content: 'Hello! How can I help?' },
];

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.mocked(getChatMessages).mockReset().mockResolvedValue(saved);
    vi.mocked(sendChatMessage).mockReset();
    vi.mocked(clearChat).mockReset().mockResolvedValue(undefined);
  });

  it('shows the saved conversation when the page opens', async () => {
    render(<ChatPanel boardId={3} onSessionEnded={() => false} />);
    expect(await screen.findByText('Hello! How can I help?')).toBeInTheDocument();
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('sends with Enter and shows the answer', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue({ id: 4, role: 'assistant', content: 'Start with the report.' });
    render(<ChatPanel boardId={3} onSessionEnded={() => false} />);
    await screen.findByText('Hi');

    await userEvent.type(screen.getByLabelText('Message'), 'What first?{Enter}');

    expect(sendChatMessage).toHaveBeenCalledWith(3, 'What first?'); // about board 3, the one that's open
    expect(screen.getByText('What first?')).toBeInTheDocument(); // your message, straight away
    expect(await screen.findByText('Start with the report.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue(''); // box cleared
  });

  it('Shift+Enter makes a new line instead of sending', async () => {
    render(<ChatPanel boardId={3} onSessionEnded={() => false} />);
    await screen.findByText('Hi');

    await userEvent.type(screen.getByLabelText('Message'), 'line one{Shift>}{Enter}{/Shift}line two');

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message')).toHaveValue('line one\nline two');
  });

  it('on failure, shows the error and gives your text back to retry', async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(new Error('The assistant is unavailable right now.'));
    render(<ChatPanel boardId={3} onSessionEnded={() => false} />);
    await screen.findByText('Hi');

    await userEvent.type(screen.getByLabelText('Message'), 'Hello?{Enter}');

    expect(await screen.findByText('The assistant is unavailable right now.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('Hello?');
    expect(screen.queryByText('Hello?', { selector: '.chat-bubble' })).not.toBeInTheDocument(); // unsent message removed
  });

  it('lets App handle an expired session instead of showing an error', async () => {
    const expired = Object.assign(new Error('Unauthorized'), { code: 'UNAUTHENTICATED' });
    vi.mocked(sendChatMessage).mockRejectedValue(expired);
    const onSessionEnded = vi.fn(() => true);
    render(<ChatPanel boardId={3} onSessionEnded={onSessionEnded} />);
    await screen.findByText('Hi');

    await userEvent.type(screen.getByLabelText('Message'), 'Hello?{Enter}');

    expect(onSessionEnded).toHaveBeenCalledWith(expired);
    expect(screen.queryByText('Unauthorized')).not.toBeInTheDocument();
  });

  it('Send is disabled for an empty or blank message', async () => {
    render(<ChatPanel boardId={3} onSessionEnded={() => false} />);
    await screen.findByText('Hi');

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Message'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('Clear chat asks first, then empties the conversation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ChatPanel boardId={3} onSessionEnded={() => false} />);
    await screen.findByText('Hi');

    await userEvent.click(screen.getByRole('button', { name: 'Clear chat' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(clearChat).toHaveBeenCalledOnce();
    expect(screen.queryByText('Hi')).not.toBeInTheDocument();
  });

  it('Clear chat does nothing if you cancel', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ChatPanel boardId={3} onSessionEnded={() => false} />);
    await screen.findByText('Hi');

    await userEvent.click(screen.getByRole('button', { name: 'Clear chat' }));

    expect(clearChat).not.toHaveBeenCalled();
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });
});
