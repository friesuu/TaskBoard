import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser, login, moveTask, sendChatMessage, createTask, getTasks } from './api';

// A fake fetch: no server needed. answer() sets what the "server" replies.
let fetchMock;
const answer = (body) => fetchMock.mockResolvedValueOnce({ json: async () => body });
const lastRequest = () => {
  const [url, options] = fetchMock.mock.calls.at(-1);
  return { url, options, body: JSON.parse(options.body) };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('api.js', () => {
  it('sends every request as POST /graphql with the login cookie', async () => {
    answer({ data: { me: { id: 1, email: 'me@test.com' } } });
    await getCurrentUser();

    const { url, options } = lastRequest();
    expect(url).toBe('http://localhost:3000/graphql');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('include'); // without this the cookie is left out
  });

  it('getCurrentUser returns the user when logged in', async () => {
    answer({ data: { me: { id: 1, email: 'me@test.com' } } });
    expect(await getCurrentUser()).toEqual({ id: 1, email: 'me@test.com' });
  });

  it('getCurrentUser returns null when not logged in (not an error)', async () => {
    answer({ errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }], data: null });
    expect(await getCurrentUser()).toBeNull();
  });

  it('getCurrentUser still throws real problems, so they can be shown', async () => {
    answer({ errors: [{ message: 'Database is down', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] });
    await expect(getCurrentUser()).rejects.toThrow('Database is down');
  });

  it('throws when the server cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(getCurrentUser()).rejects.toThrow('Failed to fetch');
  });

  it('sends the password as a variable, never inside the query text', async () => {
    answer({ data: { login: { id: 1, email: 'me@test.com' } } });
    await login('me@test.com', 'secret-password');

    const { body } = lastRequest();
    expect(body.query).not.toContain('secret-password'); // user input in the query text allows injection
    expect(body.variables).toEqual({ input: { email: 'me@test.com', password: 'secret-password' } });
  });

  it('joins validation messages into one readable error', async () => {
    answer({
      errors: [{
        message: 'Bad Request Exception',
        extensions: { code: 'BAD_REQUEST', originalError: { message: ['title should not be empty', 'title must be a string'] } },
      }],
      data: null,
    });
    await expect(createTask({ title: '' })).rejects.toThrow('title should not be empty, title must be a string');
  });

  it('keeps the error code, so the app can spot an expired session', async () => {
    answer({ errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] });
    await expect(moveTask(1, 'DONE', 0)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('sendChatMessage returns the assistant message', async () => {
    const reply = { id: 7, role: 'assistant', content: 'Hello!', createdAt: '2026-10-15T10:00:00Z' };
    answer({ data: { sendChatMessage: reply } });

    expect(await sendChatMessage(3, 'Hi')).toEqual(reply);
    expect(lastRequest().body.variables).toEqual({ input: { boardId: 3, message: 'Hi' } });
  });

  it('getTasks asks for one board, as a variable', async () => {
    answer({ data: { tasks: [] } });
    await getTasks(3);

    expect(lastRequest().body.variables).toEqual({ boardId: 3, filter: null });
  });

  it('getTasks sends the filter as a variable too', async () => {
    answer({ data: { tasks: [] } });
    await getTasks(3, { q: 'report', due: 'OVERDUE' });

    expect(lastRequest().body.variables).toEqual({ boardId: 3, filter: { q: 'report', due: 'OVERDUE' } });
  });
});
