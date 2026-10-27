import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest'; // default import: no braces
import { In, Not, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../src/app.module'; // ../ = go up one folder
import { setupApp } from '../src/app.setup';
import { Task } from '../src/tasks/task.entity';
import { User } from '../src/users/user.entity';
import { Board } from '../src/boards/board.entity';
import { LlmService } from '../src/chat/llm.service';
import { AttachmentsService } from '../src/attachments/attachments.service';
import { AUTH_COOKIE } from '../src/auth/auth-cookies';
import { todayIn } from '../src/common/dates';
import { readFile, rm, utimes } from 'fs/promises';
import { join } from 'path';

// The account every test runs as. Deleted and re-registered at the start of each run.
const TEST_USER = { email: 'e2e@test.com', password: 'e2e-password' };
// A second account that tries to reach TEST_USER's tasks (ownership tests)
const OTHER_USER = { email: 'e2e-other@test.com', password: 'e2e-password' };

const REGISTER = `
  mutation Register($input: RegisterInput!) {
    register(input: $input) { id }
  }
`;

const LOGIN = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { id }
  }
`;

const ME = `
  query {
    me { id email }
  }
`;

const CHANGE_PASSWORD = `
  mutation ChangePassword($input: ChangePasswordInput!) {
    changePassword(input: $input)
  }
`;

// Each operation is written once and reused. $name = a variable sent separately.
const TASKS = `
  query Tasks($boardId: Int!) {
    tasks(boardId: $boardId) { id title status }
  }
`;

const CREATE_TASK = `
  mutation CreateTask($input: CreateTaskInput!) {
    createTask(input: $input) { id title status dueDate }
  }
`;

const UPDATE_TASK = `
  mutation UpdateTask($id: Int!, $input: UpdateTaskInput!) {
    updateTask(id: $id, input: $input) { id title status }
  }
`;

const MOVE_TASK = `
  mutation MoveTask($id: Int!, $input: MoveTaskInput!) {
    moveTask(id: $id, input: $input) { id status position }
  }
`;

const DELETE_TASK = `
  mutation DeleteTask($id: Int!) {
    deleteTask(id: $id)
  }
`;

const BOARDS = `
  query {
    boards { id name }
  }
`;

const CREATE_BOARD = `
  mutation CreateBoard($input: BoardNameInput!) {
    createBoard(input: $input) { id name }
  }
`;

const RENAME_BOARD = `
  mutation RenameBoard($id: Int!, $input: BoardNameInput!) {
    renameBoard(id: $id, input: $input) { id name }
  }
`;

const DELETE_BOARD = `
  mutation DeleteBoard($id: Int!) {
    deleteBoard(id: $id)
  }
`;

const SEND_CHAT = `
  mutation SendChat($input: SendChatMessageInput!) {
    sendChatMessage(input: $input) { role content responseMs }
  }
`;

const CHECKLIST = `
  query Checklist($taskId: Int!) {
    checklistItems(taskId: $taskId) { id text done position }
  }
`;

const ADD_ITEM = `
  mutation AddItem($taskId: Int!, $input: ChecklistItemInput!) {
    addChecklistItem(taskId: $taskId, input: $input) { id text done position }
  }
`;

const UPDATE_ITEM = `
  mutation UpdateItem($id: Int!, $input: UpdateChecklistItemInput!) {
    updateChecklistItem(id: $id, input: $input) { id text done }
  }
`;

const MOVE_ITEM = `
  mutation MoveItem($id: Int!, $position: Int!) {
    moveChecklistItem(id: $id, position: $position) { id text position }
  }
`;

const DELETE_ITEM = `
  mutation DeleteItem($id: Int!) {
    deleteChecklistItem(id: $id)
  }
`;

// The card's "2/5"
const TASK_PROGRESS = `
  query Progress($boardId: Int!) {
    tasks(boardId: $boardId) { id checklistDone checklistTotal }
  }
`;

const COMMENTS = `
  query Comments($taskId: Int!) {
    comments(taskId: $taskId) { id body createdAt updatedAt author { email } }
  }
`;

const ADD_COMMENT = `
  mutation AddComment($taskId: Int!, $input: CommentInput!) {
    addComment(taskId: $taskId, input: $input) { id body createdAt updatedAt author { email } }
  }
`;

const UPDATE_COMMENT = `
  mutation UpdateComment($id: Int!, $input: CommentInput!) {
    updateComment(id: $id, input: $input) { id body createdAt updatedAt }
  }
`;

const DELETE_COMMENT = `
  mutation DeleteComment($id: Int!) {
    deleteComment(id: $id)
  }
`;

const LABELS = `
  query Labels($boardId: Int!) {
    labels(boardId: $boardId) { id name color boardId }
  }
`;

const CREATE_LABEL = `
  mutation CreateLabel($boardId: Int!, $input: LabelInput!) {
    createLabel(boardId: $boardId, input: $input) { id name color boardId }
  }
`;

const UPDATE_LABEL = `
  mutation UpdateLabel($id: Int!, $input: UpdateLabelInput!) {
    updateLabel(id: $id, input: $input) { id name color }
  }
`;

const DELETE_LABEL = `
  mutation DeleteLabel($id: Int!) {
    deleteLabel(id: $id)
  }
`;

const SET_TASK_LABELS = `
  mutation SetTaskLabels($taskId: Int!, $input: SetTaskLabelsInput!) {
    setTaskLabels(taskId: $taskId, input: $input) { id labels { id name color } }
  }
`;

const SET_TIME_ZONE = `
  mutation SetTimeZone($input: TimeZoneInput!) {
    setTimeZone(input: $input) { id timeZone }
  }
`;

// The board's tasks that match a filter, by title
const FILTERED = `
  query Filtered($boardId: Int!, $filter: TaskFilterInput) {
    tasks(boardId: $boardId, filter: $filter) { title }
  }
`;

const ATTACHMENTS = `
  query Attachments($taskId: Int!) {
    attachments(taskId: $taskId) { id fileName mimeType size taskId }
  }
`;

const DELETE_ATTACHMENT = `
  mutation DeleteAttachment($id: Int!) {
    deleteAttachment(id: $id)
  }
`;

// Each task with the names of its labels
const TASK_LABELS = `
  query TaskLabels($boardId: Int!) {
    tasks(boardId: $boardId) { id title labels { name color } }
  }
`;

// Stands in for Claude in these tests: no API calls, no cost. It remembers what it was given,
// so the tests can check what the assistant would see and try its tools directly.
type FakeTool = { name: string; run: (input: Record<string, unknown>) => Promise<string> };
const fakeLlm = {
  lastMessages: [] as { role: string; content: string }[],
  lastTools: [] as FakeTool[],
  delayMs: 0, // how long the fake "thinks" before answering (for the response time test)
  async reply(messages: { role: string; content: string }[], tools: FakeTool[] = []) {
    this.lastMessages = messages;
    this.lastTools = tools;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return 'Fake answer';
  },
};

describe('Tasks GraphQL API (e2e)', () => {
  let app: INestApplication; // set in beforeAll, used by every test
  let tasksRepository: Repository<Task>;
  let usersRepository: Repository<User>;
  let boardsRepository: Repository<Board>;
  let cookie: string[] = []; // TEST_USER's login cookie, sent with every request by gql()
  let otherCookie: string[] = []; // OTHER_USER's login cookie, used by the ownership tests
  let boardId: number; // TEST_USER's first board (made when registering): most tests use it
  let otherBoardId: number; // OTHER_USER's first board

  // Runs ONCE before all tests: build and start the app, then log both users in
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LlmService) // the fake above instead of the real Claude
      .useValue(fakeLlm)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app); // same CORS + validation as the real app
    await app.init();

    tasksRepository = app.get(getRepositoryToken(Task));
    usersRepository = app.get(getRepositoryToken(User));
    boardsRepository = app.get(getRepositoryToken(Board));

    cookie = await registerAndLogIn(TEST_USER);
    otherCookie = await registerAndLogIn(OTHER_USER);
    boardId = (await gql(BOARDS).expect(200)).body.data.boards[0].id;
    otherBoardId = (await gqlAsOther(BOARDS).expect(200)).body.data.boards[0].id;
  });

  // Runs ONCE after all tests: shut the app down
  afterAll(async () => {
    await app.close();
    await rm(process.env.UPLOAD_DIR!, { recursive: true, force: true }); // the test uploads
  });

  // Runs before EVERY test: no tasks, and each user back to just their first board
  beforeEach(async () => {
    // CASCADE: also empties the tables that point at these (checklist items, comments, task labels)
    await tasksRepository.query('TRUNCATE "tasks", "labels" CASCADE');
    await boardsRepository.delete({ id: Not(In([boardId, otherBoardId])) });
  });

  // Every GraphQL call is POST /graphql with { query, variables }, sent as whoever owns `who`
  const gqlAs = (who: string[], query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').set('Cookie', who).send({ query, variables });

  // As TEST_USER (most tests)
  const gql = (query: string, variables?: Record<string, unknown>) => gqlAs(cookie, query, variables);

  // As OTHER_USER (ownership tests)
  const gqlAsOther = (query: string, variables?: Record<string, unknown>) =>
    gqlAs(otherCookie, query, variables);

  // With NO cookie, as a logged-out visitor
  const gqlLoggedOut = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  // Fresh account: remove the one from the last run (its tasks go too: ON DELETE CASCADE),
  // register, log in, and return the login cookie. Fails loudly here if logging in is broken.
  const registerAndLogIn = async (user: { email: string; password: string }) => {
    await usersRepository.delete({ email: user.email });
    await gqlLoggedOut(REGISTER, { input: user }).expect(200);
    return logIn(user);
  };

  // Log in and return the login cookie. Fails loudly here if logging in is broken.
  const logIn = async (user: { email: string; password: string }) => {
    const login = await gqlLoggedOut(LOGIN, { input: user }).expect(200);
    expect(login.body.errors).toBeUndefined();
    return cookieFrom(login);
  };

  // The cookie a response sets (supertest types it as one string, but it can be a list)
  const cookieFrom = (res: { headers: Record<string, unknown> }): string[] => {
    const setCookie = res.headers['set-cookie'] as string | string[];
    return Array.isArray(setCookie) ? setCookie : [setCookie];
  };

  // Setup helper for tests that need an existing task (on TEST_USER's first board unless
  // input.boardId says otherwise). Fails loudly if creating it fails.
  const createTask = async (input: Record<string, unknown>) => {
    const res = await gql(CREATE_TASK, { input: { boardId, ...input } }).expect(200);
    expect(res.body.errors).toBeUndefined();
    return res.body.data.createTask;
  };

  // Titles of one column, in the order the board would show them
  const titlesIn = async (status: string, onBoard = boardId) => {
    const res = await gql(TASKS, { boardId: onBoard }).expect(200);
    expect(res.body.errors).toBeUndefined();
    return res.body.data.tasks
      .filter((t: { status: string }) => t.status === status)
      .map((t: { title: string }) => t.title);
  };

  // Error shapes (see step 2e):
  //   rejected by the schema      -> HTTP 400, extensions.code BAD_USER_INPUT
  //   rejected by ValidationPipe  -> HTTP 200, data null, messages in extensions.originalError.message
  //   thrown by the service       -> HTTP 200, data null, message in errors[0].message

  describe('rate limits', () => {
    // Switched off for the other tests (setup-env.ts); switched on only inside this test
    beforeEach(() => { process.env.DISABLE_RATE_LIMIT = 'false'; });
    afterEach(() => { process.env.DISABLE_RATE_LIMIT = 'true'; });

    it('blocks the 6th login attempt within a minute', async () => {
      const wrong = { input: { email: 'nobody@test.com', password: 'wrong-password' } };

      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await gqlLoggedOut(LOGIN, wrong).expect(200);
        expect(res.body.errors[0].message).toBe('Invalid email or password');
      }

      const sixth = await gqlLoggedOut(LOGIN, wrong).expect(200);
      expect(sixth.body.errors[0].message).toBe('Too many attempts. Please wait a minute and try again.');
    });
  });

  describe('login', () => {
    it('blocks task operations without a login cookie', async () => {
      const read = await gqlLoggedOut(TASKS, { boardId }).expect(200);
      expect(read.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');

      const write = await gqlLoggedOut(CREATE_TASK, { input: { boardId, title: 'Sneaky' } }).expect(200);
      expect(write.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
      expect(await tasksRepository.count()).toBe(0); // and nothing was saved
    });

    it('rejects a made-up token', async () => {
      const res = await request(app.getHttpServer())
        .post('/graphql')
        .set('Cookie', `${AUTH_COOKIE}=not-a-real-token`)
        .send({ query: TASKS, variables: { boardId } })
        .expect(200);

      expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    });

    it('me returns the logged-in user', async () => {
      const res = await gql(ME).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.me.email).toBe(TEST_USER.email);
    });

    // supertest isn't a browser and won't delete the cookie itself, so we check the instruction
    // the server sends: "the login cookie is now empty and expired in 1970". The saved test cookie keeps
    // working afterwards, because a JWT can't be cancelled: logout only removes it from the browser.
    it('logout tells the browser to delete the cookie', async () => {
      const res = await gql(`mutation { logout }`).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.logout).toBe(true);

      const setCookie = String(res.headers['set-cookie']);
      expect(setCookie).toContain(`${AUTH_COOKIE}=;`);
      expect(setCookie).toContain('Expires=Thu, 01 Jan 1970');
      expect(setCookie).toContain('HttpOnly'); // same options as login, or browsers won't clear it
    });

    it('logout also works when not logged in', async () => {
      const res = await gqlLoggedOut(`mutation { logout }`).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.logout).toBe(true);
    });
  });

  // Each test gets its own fresh account, because changing TEST_USER's password
  // would log out the cookie every other test uses.
  describe('changePassword', () => {
    const PW_USER = { email: 'e2e-password@test.com', password: 'old-password-1' };
    const NEW_PASSWORD = 'new-password-2';

    it('requires being logged in', async () => {
      const res = await gqlLoggedOut(CHANGE_PASSWORD, {
        input: { currentPassword: 'x', newPassword: NEW_PASSWORD },
      }).expect(200);

      expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    });

    it('changes the password: the old one stops working, the new one works', async () => {
      const session = await registerAndLogIn(PW_USER);

      const res = await gqlAs(session, CHANGE_PASSWORD, {
        input: { currentPassword: PW_USER.password, newPassword: NEW_PASSWORD },
      }).expect(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.changePassword).toBe(true);

      const withOld = await gqlLoggedOut(LOGIN, { input: PW_USER }).expect(200);
      expect(withOld.body.errors[0].message).toBe('Invalid email or password');

      await logIn({ email: PW_USER.email, password: NEW_PASSWORD }); // fails loudly if it doesn't work
    });

    it('rejects a wrong current password, and does not log you out', async () => {
      const session = await registerAndLogIn(PW_USER);

      const res = await gqlAs(session, CHANGE_PASSWORD, {
        input: { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD },
      }).expect(200);

      expect(res.body.errors[0].message).toBe('Current password is incorrect');
      // BAD_REQUEST, not UNAUTHENTICATED: the frontend logs you out on UNAUTHENTICATED
      expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
      await logIn(PW_USER); // the old password still works
    });

    it('rejects a new password that is too short', async () => {
      const session = await registerAndLogIn(PW_USER);

      const res = await gqlAs(session, CHANGE_PASSWORD, {
        input: { currentPassword: PW_USER.password, newPassword: 'short' },
      }).expect(200);

      expect(res.body.errors[0].extensions.originalError.message).toContain(
        'newPassword must be longer than or equal to 8 characters',
      );
    });

    it('rejects a new password that is the same as the current one', async () => {
      const session = await registerAndLogIn(PW_USER);

      const res = await gqlAs(session, CHANGE_PASSWORD, {
        input: { currentPassword: PW_USER.password, newPassword: PW_USER.password },
      }).expect(200);

      expect(res.body.errors[0].message).toBe('New password must be different from the current one');
    });

    it('logs out every other session, but keeps this one logged in', async () => {
      const laptop = await registerAndLogIn(PW_USER); // two devices logged in
      const phone = await logIn(PW_USER);

      const res = await gqlAs(laptop, CHANGE_PASSWORD, {
        input: { currentPassword: PW_USER.password, newPassword: NEW_PASSWORD },
      }).expect(200);
      const laptopNewCookie = cookieFrom(res);

      // The phone's token was made before the change: it no longer works
      const onPhone = await gqlAs(phone, ME).expect(200);
      expect(onPhone.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');

      // The laptop's OLD cookie doesn't work either (a stolen copy would be useless now)...
      const oldLaptop = await gqlAs(laptop, ME).expect(200);
      expect(oldLaptop.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');

      // ...but the fresh cookie it just received does
      const newLaptop = await gqlAs(laptopNewCookie, ME).expect(200);
      expect(newLaptop.body.data.me.email).toBe(PW_USER.email);
    });
  });

  // OTHER_USER tries every way to reach TEST_USER's tasks. Each attempt must look exactly like
  // "this task doesn't exist", so an attacker can't even learn that the task is there.
  describe('ownership (another user)', () => {
    it('does not see my tasks', async () => {
      await createTask({ title: 'Mine' });

      const res = await gqlAsOther(TASKS, { boardId: otherBoardId }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.tasks).toEqual([]);
    });

    it('cannot update my task', async () => {
      const mine = await createTask({ title: 'Mine' });

      const res = await gqlAsOther(UPDATE_TASK, {
        id: mine.id,
        input: { title: 'Hacked' },
      }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].message).toBe(`Task ${mine.id} not found`);
      expect(await titlesIn('TODO')).toEqual(['Mine']); // unchanged
    });

    it('cannot move my task', async () => {
      const mine = await createTask({ title: 'Mine' });

      const res = await gqlAsOther(MOVE_TASK, {
        id: mine.id,
        input: { status: 'DONE', position: 0 },
      }).expect(200);

      expect(res.body.errors[0].message).toBe(`Task ${mine.id} not found`);
      expect(await titlesIn('TODO')).toEqual(['Mine']); // still in its column
      expect(await titlesIn('DONE')).toEqual([]);
    });

    it('cannot delete my task', async () => {
      const mine = await createTask({ title: 'Mine' });

      const res = await gqlAsOther(DELETE_TASK, { id: mine.id }).expect(200);

      expect(res.body.errors[0].message).toBe(`Task ${mine.id} not found`);
      expect(await titlesIn('TODO')).toEqual(['Mine']); // still there
    });

    it('gets the same kind of error for my task as for a task that does not exist', async () => {
      const mine = await createTask({ title: 'Mine' });

      const forMine = await gqlAsOther(DELETE_TASK, { id: mine.id }).expect(200);
      const forNothing = await gqlAsOther(DELETE_TASK, { id: 999999 }).expect(200);

      expect(forMine.body.errors[0].extensions.code).toBe(forNothing.body.errors[0].extensions.code);
      expect(forMine.body.errors[0].message).toBe(`Task ${mine.id} not found`);
      expect(forNothing.body.errors[0].message).toBe('Task 999999 not found');
    });

    it('does not show their tasks in my list', async () => {
      await gqlAsOther(CREATE_TASK, { input: { boardId: otherBoardId, title: 'Theirs' } }).expect(200);

      expect(await titlesIn('TODO')).toEqual([]);
    });

    it('keeps separate column order for each user', async () => {
      await createTask({ title: 'A' });
      const b = await createTask({ title: 'B' });
      const theirs = await gqlAsOther(CREATE_TASK, {
        input: { boardId: otherBoardId, title: 'Theirs' },
      }).expect(200);
      const theirsId = theirs.body.data.createTask.id;

      // Their first task is at the top of THEIR column, even though I already have two
      expect((await tasksRepository.findOneByOrFail({ id: theirsId })).position).toBe(0);

      // Reordering my column doesn't renumber theirs
      await gql(MOVE_TASK, { id: b.id, input: { status: 'TODO', position: 0 } }).expect(200);
      expect(await titlesIn('TODO')).toEqual(['B', 'A']);
      expect((await tasksRepository.findOneByOrFail({ id: theirsId })).position).toBe(0);
    });
  });

  describe('boards', () => {
    // Setup helper: a new board for TEST_USER. Fails loudly if creating it fails.
    const createBoard = async (name: string) => {
      const res = await gql(CREATE_BOARD, { input: { name } }).expect(200);
      expect(res.body.errors).toBeUndefined();
      return res.body.data.createBoard as { id: number; name: string };
    };

    it('a new account starts with one board called "My board"', async () => {
      const session = await registerAndLogIn({ email: 'e2e-boards@test.com', password: 'e2e-password' });

      const res = await gqlAs(session, BOARDS).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.boards.map((b: { name: string }) => b.name)).toEqual(['My board']);
      await usersRepository.delete({ email: 'e2e-boards@test.com' });
    });

    it('creates a board (trimmed), listed after the older ones', async () => {
      await createBoard('  Work  ');

      const res = await gql(BOARDS).expect(200);

      expect(res.body.data.boards.map((b: { name: string }) => b.name)).toEqual(['My board', 'Work']);
    });

    it('rejects an empty board name', async () => {
      const res = await gql(CREATE_BOARD, { input: { name: '   ' } }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].extensions.originalError.message).toContain('name should not be empty');
    });

    it('renames a board', async () => {
      const work = await createBoard('Work');

      const res = await gql(RENAME_BOARD, { id: work.id, input: { name: 'Office' } }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.renameBoard.name).toBe('Office');
    });

    it('keeps tasks and column order separate for each board', async () => {
      const work = await createBoard('Work');
      await createTask({ title: 'Home 1' });
      await createTask({ title: 'Home 2' });
      const w = await createTask({ title: 'Work 1', boardId: work.id });

      expect(await titlesIn('TODO')).toEqual(['Home 1', 'Home 2']);
      expect(await titlesIn('TODO', work.id)).toEqual(['Work 1']);
      // The first task on the new board is at the top of ITS column
      expect((await tasksRepository.findOneByOrFail({ id: w.id })).position).toBe(0);
    });

    it('moving a task only renumbers its own board', async () => {
      const work = await createBoard('Work');
      const home = await createTask({ title: 'Home' });
      await createTask({ title: 'Work 1', boardId: work.id });
      const w2 = await createTask({ title: 'Work 2', boardId: work.id });

      await gql(MOVE_TASK, { id: w2.id, input: { status: 'TODO', position: 0 } }).expect(200);

      expect(await titlesIn('TODO', work.id)).toEqual(['Work 2', 'Work 1']);
      expect(await titlesIn('TODO')).toEqual(['Home']);
      expect((await tasksRepository.findOneByOrFail({ id: home.id })).position).toBe(0);
    });

    it('deletes a board and its tasks', async () => {
      const work = await createBoard('Work');
      await createTask({ title: 'Work 1', boardId: work.id });
      await createTask({ title: 'Home' });

      const res = await gql(DELETE_BOARD, { id: work.id }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.deleteBoard).toBe(true);
      expect(await tasksRepository.countBy({ boardId: work.id })).toBe(0);
      expect(await titlesIn('TODO')).toEqual(['Home']); // other boards untouched
    });

    it('refuses to delete your last board', async () => {
      const res = await gql(DELETE_BOARD, { id: boardId }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].message).toBe("You can't delete your last board");
    });

    it('needs a board to create a task on', async () => {
      const res = await gql(CREATE_TASK, { input: { title: 'Nowhere' } }).expect(400);

      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('rejects a board that does not exist', async () => {
      const res = await gql(CREATE_TASK, { input: { boardId: 999999, title: 'Nowhere' } }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].message).toBe('Board 999999 not found');
    });

    it('cannot move a task to another board with updateTask', async () => {
      const work = await createBoard('Work');
      const home = await createTask({ title: 'Home' });

      const res = await gql(UPDATE_TASK, { id: home.id, input: { boardId: work.id } }).expect(400);

      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });
  });

  // Same rule as for tasks: someone else's board looks exactly like one that doesn't exist
  describe('board ownership (another user)', () => {
    it('does not list my boards', async () => {
      const res = await gqlAsOther(BOARDS).expect(200);

      expect(res.body.data.boards.map((b: { id: number }) => b.id)).toEqual([otherBoardId]);
    });

    it("gets nothing when asking for my board's tasks", async () => {
      await createTask({ title: 'Mine' });

      const res = await gqlAsOther(TASKS, { boardId }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.tasks).toEqual([]);
    });

    it('cannot add a task to my board', async () => {
      const res = await gqlAsOther(CREATE_TASK, { input: { boardId, title: 'Sneaky' } }).expect(200);

      expect(res.body.errors[0].message).toBe(`Board ${boardId} not found`);
      expect(await titlesIn('TODO')).toEqual([]);
    });

    it('cannot rename or delete my board', async () => {
      const rename = await gqlAsOther(RENAME_BOARD, { id: boardId, input: { name: 'Hacked' } }).expect(200);
      const remove = await gqlAsOther(DELETE_BOARD, { id: boardId }).expect(200);

      expect(rename.body.errors[0].message).toBe(`Board ${boardId} not found`);
      expect(remove.body.errors[0].message).toBe(`Board ${boardId} not found`);
      expect((await boardsRepository.findOneByOrFail({ id: boardId })).name).toBe('My board');
    });
  });

  // The fake LlmService records what the assistant was given, so no real Claude call is made
  describe('assistant (chat) stays on the current board', () => {
    const toolNamed = (name: string) => fakeLlm.lastTools.find((t) => t.name === name)!;

    beforeEach(async () => {
      await gql(`mutation { clearChat }`).expect(200);
    });

    it("only shows the assistant the current board's tasks", async () => {
      const work = (await gql(CREATE_BOARD, { input: { name: 'Work' } }).expect(200)).body.data.createBoard;
      await createTask({ title: 'Home task' });
      await createTask({ title: 'Work task', boardId: work.id });

      const res = await gql(SEND_CHAT, { input: { boardId: work.id, message: 'What is on my list?' } }).expect(200);

      expect(res.body.errors).toBeUndefined();
      const sent = fakeLlm.lastMessages.at(-1)!.content;
      expect(sent).toContain('Work task');
      expect(sent).not.toContain('Home task');
    });

    it('saves how long the answer took on the reply, not on your message', async () => {
      fakeLlm.delayMs = 60; // the fake takes 60 ms to answer
      try {
        const res = await gql(SEND_CHAT, { input: { boardId, message: 'Hi' } }).expect(200);
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.sendChatMessage.responseMs).toBeGreaterThanOrEqual(50);
      } finally {
        fakeLlm.delayMs = 0;
      }

      const history = (await gql(`query { chatMessages { role responseMs } }`).expect(200)).body.data.chatMessages;
      expect(history).toEqual([
        { role: 'user', responseMs: null },
        { role: 'assistant', responseMs: expect.any(Number) },
      ]);
      expect(history[1].responseMs).toBeGreaterThanOrEqual(50); // saved, so it still shows after a refresh
    });

    it("refuses another user's board", async () => {
      const res = await gqlAsOther(SEND_CHAT, { input: { boardId, message: 'Hi' } }).expect(200);

      expect(res.body.errors[0].message).toBe(`Board ${boardId} not found`);
    });

    it('its tools create tasks on the current board and cannot touch other boards', async () => {
      const work = (await gql(CREATE_BOARD, { input: { name: 'Work' } }).expect(200)).body.data.createBoard;
      const home = await createTask({ title: 'Home task' });
      await gql(SEND_CHAT, { input: { boardId: work.id, message: 'Hi' } }).expect(200);

      await toolNamed('create_task').run({ title: 'Made by the assistant' });
      expect(await titlesIn('TODO', work.id)).toEqual(['Made by the assistant']);

      await expect(toolNamed('update_task').run({ id: home.id, title: 'Changed' })).rejects.toThrow(
        `Task ${home.id} not found on this board`,
      );
      await expect(toolNamed('move_task').run({ id: home.id, status: 'done' })).rejects.toThrow(
        `Task ${home.id} not found on this board`,
      );
      expect(await titlesIn('TODO')).toEqual(['Home task']); // unchanged, still in To do
    });

    it('sees labels and checklists, and its tools change them on the current board only', async () => {
      const work = (await gql(CREATE_BOARD, { input: { name: 'Work' } }).expect(200)).body.data.createBoard;
      await gql(CREATE_LABEL, { boardId: work.id, input: { name: 'Urgent', color: 'ORANGE' } }).expect(200);
      const task = await createTask({ title: 'Ship it', boardId: work.id, dueDate: '2026-11-01' });
      const home = await createTask({ title: 'Home task' });
      const item = (await gql(ADD_ITEM, { taskId: task.id, input: { text: 'Write notes' } }).expect(200)).body.data.addChecklistItem;
      await gql(SEND_CHAT, { input: { boardId: work.id, message: 'Hi' } }).expect(200);

      const sent = fakeLlm.lastMessages.at(-1)!.content;
      expect(sent).toContain('Labels on this board: Urgent (orange)');
      expect(sent).toContain(`[ ] c${item.id} Write notes`);

      // Labels: create one, put both on the task, take one off, rename and recolour
      await toolNamed('create_label').run({ name: 'Waiting', color: 'blue' });
      expect(await toolNamed('change_task_labels').run({ id: task.id, add: ['urgent', 'Waiting'] })).toContain('now has: Urgent, Waiting');
      expect(await toolNamed('change_task_labels').run({ id: task.id, remove: ['Waiting'] })).toContain('now has: Urgent.');
      await toolNamed('update_label').run({ name: 'Urgent', newName: 'Asap', color: 'pink' });
      await expect(toolNamed('change_task_labels').run({ id: task.id, add: ['Nope'] })).rejects.toThrow(
        'No label called "Nope" on this board. Its labels: "Asap", "Waiting"',
      );
      const labels = (await gql(TASK_LABELS, { boardId: work.id }).expect(200)).body.data.tasks[0].labels;
      expect(labels).toEqual([{ name: 'Asap', color: 'PINK' }]);

      // Checklist: add two, tick the first one and rename it
      await toolNamed('add_checklist_items').run({ id: task.id, items: ['Test it', 'Tell the team'] });
      await toolNamed('update_checklist_item').run({ itemId: item.id, done: true, text: 'Write release notes' });
      const items = (await gql(`query ($taskId: Int!) { checklistItems(taskId: $taskId) { text done } }`, { taskId: task.id }).expect(200))
        .body.data.checklistItems;
      expect(items).toEqual([
        { text: 'Write release notes', done: true },
        { text: 'Test it', done: false },
        { text: 'Tell the team', done: false },
      ]);

      // The due date can be removed
      await toolNamed('update_task').run({ id: task.id, dueDate: null });
      expect((await tasksRepository.findOneByOrFail({ id: task.id })).dueDate).toBeNull();

      // Nothing on another board
      await expect(toolNamed('change_task_labels').run({ id: home.id, add: ['Asap'] })).rejects.toThrow(`Task ${home.id} not found on this board`);
      await expect(toolNamed('add_checklist_items').run({ id: home.id, items: ['x'] })).rejects.toThrow(`Task ${home.id} not found on this board`);
      const homeItem = (await gql(ADD_ITEM, { taskId: home.id, input: { text: 'Home item' } }).expect(200)).body.data.addChecklistItem;
      await expect(toolNamed('update_checklist_item').run({ itemId: homeItem.id, done: true })).rejects.toThrow(
        `Task ${home.id} not found on this board`,
      );
    });
  });

  describe('checklist', () => {
    // Setup helper: adds an item to a task and returns it. Fails loudly if adding fails.
    const addItem = async (taskId: number, text: string) => {
      const res = await gql(ADD_ITEM, { taskId, input: { text } }).expect(200);
      expect(res.body.errors).toBeUndefined();
      return res.body.data.addChecklistItem as { id: number; text: string; done: boolean };
    };

    const itemTexts = async (taskId: number) =>
      (await gql(CHECKLIST, { taskId }).expect(200)).body.data.checklistItems.map((i: { text: string }) => i.text);

    const progressOf = async (taskId: number) => {
      const res = await gql(TASK_PROGRESS, { boardId }).expect(200);
      const task = res.body.data.tasks.find((t: { id: number }) => t.id === taskId);
      return `${task.checklistDone}/${task.checklistTotal}`;
    };

    it('adds items (trimmed) at the bottom, unticked', async () => {
      const task = await createTask({ title: 'Plan party' });

      const first = await addItem(task.id, '  Book the room  ');
      await addItem(task.id, 'Order cake');

      expect(first).toMatchObject({ text: 'Book the room', done: false });
      expect(await itemTexts(task.id)).toEqual(['Book the room', 'Order cake']);
    });

    it('a new task has an empty checklist (0/0)', async () => {
      const res = await gql(
        `mutation ($input: CreateTaskInput!) { createTask(input: $input) { checklistDone checklistTotal } }`,
        { input: { boardId, title: 'Fresh' } },
      ).expect(200);

      expect(res.body.data.createTask).toEqual({ checklistDone: 0, checklistTotal: 0 });
    });

    it('ticking an item updates the progress on the card', async () => {
      const task = await createTask({ title: 'Plan party' });
      const room = await addItem(task.id, 'Book the room');
      await addItem(task.id, 'Order cake');
      expect(await progressOf(task.id)).toBe('0/2');

      const res = await gql(UPDATE_ITEM, { id: room.id, input: { done: true } }).expect(200);

      expect(res.body.data.updateChecklistItem).toMatchObject({ text: 'Book the room', done: true });
      expect(await progressOf(task.id)).toBe('1/2');
    });

    it('renames an item', async () => {
      const task = await createTask({ title: 'Plan party' });
      const item = await addItem(task.id, 'Order cake');

      await gql(UPDATE_ITEM, { id: item.id, input: { text: 'Order a big cake' } }).expect(200);

      expect(await itemTexts(task.id)).toEqual(['Order a big cake']);
    });

    it('reorders items', async () => {
      const task = await createTask({ title: 'Plan party' });
      await addItem(task.id, 'A');
      await addItem(task.id, 'B');
      const c = await addItem(task.id, 'C');

      const res = await gql(MOVE_ITEM, { id: c.id, position: 0 }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(await itemTexts(task.id)).toEqual(['C', 'A', 'B']);
    });

    it('deletes an item', async () => {
      const task = await createTask({ title: 'Plan party' });
      const a = await addItem(task.id, 'A');
      await addItem(task.id, 'B');

      const res = await gql(DELETE_ITEM, { id: a.id }).expect(200);

      expect(res.body.data.deleteChecklistItem).toBe(true);
      expect(await itemTexts(task.id)).toEqual(['B']);
      expect(await progressOf(task.id)).toBe('0/1');
    });

    it('rejects empty text and text over 200 characters', async () => {
      const task = await createTask({ title: 'Plan party' });

      const empty = await gql(ADD_ITEM, { taskId: task.id, input: { text: '   ' } }).expect(200);
      const long = await gql(ADD_ITEM, { taskId: task.id, input: { text: 'a'.repeat(201) } }).expect(200);

      expect(empty.body.errors[0].extensions.originalError.message).toContain('text should not be empty');
      expect(long.body.errors[0].extensions.code).toBe('BAD_REQUEST');
      expect(await itemTexts(task.id)).toEqual([]);
    });

    it('goes when its task is deleted', async () => {
      const task = await createTask({ title: 'Plan party' });
      await addItem(task.id, 'A');

      await gql(DELETE_TASK, { id: task.id }).expect(200);

      const res = await gql(CHECKLIST, { taskId: task.id }).expect(200);
      expect(res.body.errors[0].message).toBe(`Task ${task.id} not found`);
    });

    it("another user can't see or change my checklist", async () => {
      const task = await createTask({ title: 'Mine' });
      const item = await addItem(task.id, 'Secret step');

      const read = await gqlAsOther(CHECKLIST, { taskId: task.id }).expect(200);
      const add = await gqlAsOther(ADD_ITEM, { taskId: task.id, input: { text: 'Sneaky' } }).expect(200);
      const tick = await gqlAsOther(UPDATE_ITEM, { id: item.id, input: { done: true } }).expect(200);
      const move = await gqlAsOther(MOVE_ITEM, { id: item.id, position: 0 }).expect(200);
      const remove = await gqlAsOther(DELETE_ITEM, { id: item.id }).expect(200);

      expect(read.body.errors[0].message).toBe(`Task ${task.id} not found`);
      expect(add.body.errors[0].message).toBe(`Task ${task.id} not found`);
      expect(tick.body.errors[0].message).toBe(`Checklist item ${item.id} not found`);
      expect(move.body.errors[0].message).toBe(`Checklist item ${item.id} not found`);
      expect(remove.body.errors[0].message).toBe(`Checklist item ${item.id} not found`);
      expect(await itemTexts(task.id)).toEqual(['Secret step']);
      expect(await progressOf(task.id)).toBe('0/1'); // still unticked
    });
  });

  describe('comments', () => {
    const addComment = async (taskId: number, body: string, as = cookie) => {
      const res = await gqlAs(as, ADD_COMMENT, { taskId, input: { body } }).expect(200);
      expect(res.body.errors).toBeUndefined();
      return res.body.data.addComment as { id: number; body: string; createdAt: string; updatedAt: string };
    };

    it('adds a comment with its author and time', async () => {
      const task = await createTask({ title: 'Write report' });

      const comment = await addComment(task.id, '  Started on the intro  ');

      expect(comment.body).toBe('Started on the intro');
      expect(comment).toMatchObject({ author: { email: TEST_USER.email } });
      expect(new Date(comment.createdAt).getTime()).not.toBeNaN();
      expect(comment.updatedAt).toBe(comment.createdAt); // not edited yet
    });

    it('lists comments oldest first (newest at the bottom)', async () => {
      const task = await createTask({ title: 'Write report' });
      await addComment(task.id, 'First');
      await addComment(task.id, 'Second');

      const res = await gql(COMMENTS, { taskId: task.id }).expect(200);

      expect(res.body.data.comments.map((c: { body: string }) => c.body)).toEqual(['First', 'Second']);
    });

    it('edits your own comment and marks it as edited', async () => {
      const task = await createTask({ title: 'Write report' });
      const comment = await addComment(task.id, 'Typo hree');

      const res = await gql(UPDATE_COMMENT, { id: comment.id, input: { body: 'Typo here' } }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.updateComment.body).toBe('Typo here');
      expect(new Date(res.body.data.updateComment.updatedAt).getTime()).toBeGreaterThan(
        new Date(comment.createdAt).getTime(),
      );
    });

    it('deletes your own comment', async () => {
      const task = await createTask({ title: 'Write report' });
      const comment = await addComment(task.id, 'Never mind');

      const res = await gql(DELETE_COMMENT, { id: comment.id }).expect(200);

      expect(res.body.data.deleteComment).toBe(true);
      expect((await gql(COMMENTS, { taskId: task.id }).expect(200)).body.data.comments).toEqual([]);
    });

    it('rejects an empty comment and one over 2000 characters', async () => {
      const task = await createTask({ title: 'Write report' });

      const empty = await gql(ADD_COMMENT, { taskId: task.id, input: { body: '  ' } }).expect(200);
      const long = await gql(ADD_COMMENT, { taskId: task.id, input: { body: 'a'.repeat(2001) } }).expect(200);

      expect(empty.body.errors[0].extensions.originalError.message).toContain('body should not be empty');
      expect(long.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });

    it("another user can't read, add to, edit or delete my comments", async () => {
      const task = await createTask({ title: 'Mine' });
      const comment = await addComment(task.id, 'Private note');

      const read = await gqlAsOther(COMMENTS, { taskId: task.id }).expect(200);
      const add = await gqlAsOther(ADD_COMMENT, { taskId: task.id, input: { body: 'Sneaky' } }).expect(200);
      const edit = await gqlAsOther(UPDATE_COMMENT, { id: comment.id, input: { body: 'Hacked' } }).expect(200);
      const remove = await gqlAsOther(DELETE_COMMENT, { id: comment.id }).expect(200);

      expect(read.body.errors[0].message).toBe(`Task ${task.id} not found`);
      expect(add.body.errors[0].message).toBe(`Task ${task.id} not found`);
      expect(edit.body.errors[0].message).toBe(`Comment ${comment.id} not found`);
      expect(remove.body.errors[0].message).toBe(`Comment ${comment.id} not found`);
      const mine = (await gql(COMMENTS, { taskId: task.id }).expect(200)).body.data.comments;
      expect(mine.map((c: { body: string }) => c.body)).toEqual(['Private note']);
    });
  });

  describe('labels', () => {
    // Setup helper: a label on TEST_USER's first board (unless onBoard says otherwise). Fails loudly.
    const createLabel = async (name: string, color = 'BLUE', onBoard = boardId) => {
      const res = await gql(CREATE_LABEL, { boardId: onBoard, input: { name, color } }).expect(200);
      expect(res.body.errors).toBeUndefined();
      return res.body.data.createLabel as { id: number; name: string; color: string };
    };

    const labelNamesOn = async (taskId: number) => {
      const res = await gql(TASK_LABELS, { boardId }).expect(200);
      return res.body.data.tasks
        .find((t: { id: number }) => t.id === taskId)
        .labels.map((l: { name: string }) => l.name);
    };

    it('creates labels (trimmed) and lists them A to Z', async () => {
      await createLabel('  Urgent  ', 'ORANGE');
      await createLabel('Client', 'TEAL');

      const res = await gql(LABELS, { boardId }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.labels).toEqual([
        expect.objectContaining({ name: 'Client', color: 'TEAL', boardId }),
        expect.objectContaining({ name: 'Urgent', color: 'ORANGE', boardId }),
      ]);
    });

    it('a new task has no labels', async () => {
      const task = await createTask({ title: 'Plain' });

      expect(await labelNamesOn(task.id)).toEqual([]);
    });

    it('rejects a duplicate name on the same board, ignoring capitals', async () => {
      await createLabel('Urgent');

      const res = await gql(CREATE_LABEL, { boardId, input: { name: 'URGENT', color: 'PINK' } }).expect(200);

      expect(res.body.errors[0].message).toBe('There is already a label called "URGENT" on this board');
    });

    it('allows the same name on another board', async () => {
      await createLabel('Urgent');
      const work = (await gql(CREATE_BOARD, { input: { name: 'Work' } }).expect(200)).body.data.createBoard;

      const res = await gql(CREATE_LABEL, { boardId: work.id, input: { name: 'Urgent', color: 'PINK' } }).expect(200);

      expect(res.body.errors).toBeUndefined();
    });

    it('rejects an empty name, a name over 30 characters, and a colour outside the palette', async () => {
      const empty = await gql(CREATE_LABEL, { boardId, input: { name: '  ', color: 'BLUE' } }).expect(200);
      const long = await gql(CREATE_LABEL, { boardId, input: { name: 'a'.repeat(31), color: 'BLUE' } }).expect(200);
      const red = await gql(CREATE_LABEL, { boardId, input: { name: 'Hot', color: 'RED' } }).expect(400);

      expect(empty.body.errors[0].extensions.originalError.message).toContain('name should not be empty');
      expect(long.body.errors[0].extensions.code).toBe('BAD_REQUEST');
      expect(red.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('gives a task several labels, A to Z, and replaces them', async () => {
      const task = await createTask({ title: 'Report' });
      const urgent = await createLabel('Urgent', 'ORANGE');
      const client = await createLabel('Client', 'TEAL');

      const res = await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [urgent.id, client.id] } }).expect(200);
      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.setTaskLabels.labels.map((l: { name: string }) => l.name)).toEqual(['Client', 'Urgent']);
      expect(await labelNamesOn(task.id)).toEqual(['Client', 'Urgent']);

      await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [urgent.id] } }).expect(200);
      expect(await labelNamesOn(task.id)).toEqual(['Urgent']);

      await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [] } }).expect(200);
      expect(await labelNamesOn(task.id)).toEqual([]);
    });

    it('keeps the labels when the task is edited or moved', async () => {
      const task = await createTask({ title: 'Report' });
      const urgent = await createLabel('Urgent');
      await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [urgent.id] } }).expect(200);

      const moved = await gql(
        `mutation ($id: Int!, $input: MoveTaskInput!) { moveTask(id: $id, input: $input) { labels { name } } }`,
        { id: task.id, input: { status: 'DONE', position: 0 } },
      ).expect(200);
      await gql(UPDATE_TASK, { id: task.id, input: { title: 'Report v2' } }).expect(200);

      expect(moved.body.data.moveTask.labels).toEqual([{ name: 'Urgent' }]);
      expect(await labelNamesOn(task.id)).toEqual(['Urgent']);
    });

    it('renaming or recolouring a label shows on its tasks', async () => {
      const task = await createTask({ title: 'Report' });
      const label = await createLabel('Urgent', 'ORANGE');
      await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [label.id] } }).expect(200);

      const res = await gql(UPDATE_LABEL, { id: label.id, input: { name: 'Critical', color: 'PINK' } }).expect(200);

      expect(res.body.data.updateLabel).toMatchObject({ name: 'Critical', color: 'PINK' });
      const tasks = (await gql(TASK_LABELS, { boardId }).expect(200)).body.data.tasks;
      expect(tasks[0].labels).toEqual([{ name: 'Critical', color: 'PINK' }]);
    });

    it('deleting a label takes it off its tasks', async () => {
      const task = await createTask({ title: 'Report' });
      const label = await createLabel('Urgent');
      await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [label.id] } }).expect(200);

      const res = await gql(DELETE_LABEL, { id: label.id }).expect(200);

      expect(res.body.data.deleteLabel).toBe(true);
      expect(await labelNamesOn(task.id)).toEqual([]);
    });

    it("can't give a task a label from another board", async () => {
      const task = await createTask({ title: 'Report' });
      const work = (await gql(CREATE_BOARD, { input: { name: 'Work' } }).expect(200)).body.data.createBoard;
      const workLabel = await createLabel('Work only', 'BLUE', work.id);

      const res = await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [workLabel.id] } }).expect(200);

      expect(res.body.errors[0].message).toBe('Label not found on this board');
      expect(await labelNamesOn(task.id)).toEqual([]);
    });

    it('allows at most 10 labels on a task', async () => {
      const task = await createTask({ title: 'Report' });

      const res = await gql(SET_TASK_LABELS, {
        taskId: task.id,
        input: { labelIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      }).expect(200);

      expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });

    it("another user can't see, change, delete or use my labels", async () => {
      const task = await createTask({ title: 'Mine' });
      const label = await createLabel('Secret');
      const theirTask = (
        await gqlAsOther(CREATE_TASK, { input: { boardId: otherBoardId, title: 'Theirs' } }).expect(200)
      ).body.data.createTask;

      const read = await gqlAsOther(LABELS, { boardId }).expect(200);
      const add = await gqlAsOther(CREATE_LABEL, { boardId, input: { name: 'Sneaky', color: 'BLUE' } }).expect(200);
      const rename = await gqlAsOther(UPDATE_LABEL, { id: label.id, input: { name: 'Hacked' } }).expect(200);
      const remove = await gqlAsOther(DELETE_LABEL, { id: label.id }).expect(200);
      const onMyTask = await gqlAsOther(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [] } }).expect(200);
      const onTheirTask = await gqlAsOther(SET_TASK_LABELS, {
        taskId: theirTask.id,
        input: { labelIds: [label.id] },
      }).expect(200);

      expect(read.body.errors[0].message).toBe(`Board ${boardId} not found`);
      expect(add.body.errors[0].message).toBe(`Board ${boardId} not found`);
      expect(rename.body.errors[0].message).toBe(`Label ${label.id} not found`);
      expect(remove.body.errors[0].message).toBe(`Label ${label.id} not found`);
      expect(onMyTask.body.errors[0].message).toBe(`Task ${task.id} not found`);
      expect(onTheirTask.body.errors[0].message).toBe('Label not found on this board');
      const mine = (await gql(LABELS, { boardId }).expect(200)).body.data.labels;
      expect(mine.map((l: { name: string }) => l.name)).toEqual(['Secret']);
    });

    it('deleting a board deletes its labels', async () => {
      const work = (await gql(CREATE_BOARD, { input: { name: 'Work' } }).expect(200)).body.data.createBoard;
      await createLabel('Work only', 'BLUE', work.id);

      await gql(DELETE_BOARD, { id: work.id }).expect(200);

      const left = await tasksRepository.query('SELECT count(*)::int AS n FROM labels WHERE board_id = $1', [work.id]);
      expect(left).toEqual([{ n: 0 }]);
    });
  });

  describe('time zone', () => {
    it('remembers the time zone the browser sends, and me returns it', async () => {
      const res = await gql(SET_TIME_ZONE, { input: { timeZone: 'Asia/Kuala_Lumpur' } }).expect(200);

      expect(res.body.errors).toBeUndefined();
      const me = await gql(`query { me { timeZone } }`).expect(200);
      expect(me.body.data.me.timeZone).toBe('Asia/Kuala_Lumpur');
    });

    it('rejects a time zone that does not exist', async () => {
      const res = await gql(SET_TIME_ZONE, { input: { timeZone: 'Mars/Olympus_Mons' } }).expect(200);

      expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });

    it('needs a login', async () => {
      const res = await gqlLoggedOut(SET_TIME_ZONE, { input: { timeZone: 'Europe/London' } }).expect(200);

      expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('search and filters', () => {
    const titlesMatching = async (filter: Record<string, unknown>) => {
      const res = await gql(FILTERED, { boardId, filter }).expect(200);
      expect(res.body.errors).toBeUndefined();
      return res.body.data.tasks.map((t: { title: string }) => t.title).sort();
    };

    const createLabel = async (name: string) =>
      (await gql(CREATE_LABEL, { boardId, input: { name, color: 'BLUE' } }).expect(200)).body.data.createLabel.id;

    const labelTask = (taskId: number, labelIds: number[]) =>
      gql(SET_TASK_LABELS, { taskId, input: { labelIds } }).expect(200);

    // A date as YYYY-MM-DD in a time zone, `days` from today there (worked out here, separately from the app)
    const dateIn = (timeZone: string, days = 0) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date());
      const date = new Date(`${parts}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };

    it('without a filter, returns every task', async () => {
      await createTask({ title: 'A' });
      await createTask({ title: 'B' });

      const res = await gql(FILTERED, { boardId }).expect(200);

      expect(res.body.data.tasks).toHaveLength(2);
    });

    it('searches titles, notes and checklist items, ignoring capitals', async () => {
      await createTask({ title: 'Invoice for ACME' });
      await createTask({ title: 'Call', description: 'ask about the acme contract' });
      const withItem = await createTask({ title: 'Prepare' });
      await gql(ADD_ITEM, { taskId: withItem.id, input: { text: 'Print Acme slides' } }).expect(200);
      await createTask({ title: 'Unrelated' });

      expect(await titlesMatching({ q: 'acme' })).toEqual(['Call', 'Invoice for ACME', 'Prepare']);
    });

    it('treats % and _ in the search as normal characters', async () => {
      await createTask({ title: '100% done' });
      await createTask({ title: 'Other' });
      await createTask({ title: 'snake_case' });

      expect(await titlesMatching({ q: '%' })).toEqual(['100% done']);
      expect(await titlesMatching({ q: '_' })).toEqual(['snake_case']);
    });

    it('matches tasks with ANY of the chosen labels, and still returns all their labels', async () => {
      const urgent = await createLabel('Urgent');
      const client = await createLabel('Client');
      const a = await createTask({ title: 'Has urgent' });
      const b = await createTask({ title: 'Has client' });
      await createTask({ title: 'No labels' });
      await labelTask(a.id, [urgent, client]);
      await labelTask(b.id, [client]);

      expect(await titlesMatching({ labelIds: [urgent] })).toEqual(['Has urgent']);
      expect(await titlesMatching({ labelIds: [urgent, client] })).toEqual(['Has client', 'Has urgent']);

      const res = await gql(
        `query ($boardId: Int!, $filter: TaskFilterInput) { tasks(boardId: $boardId, filter: $filter) { labels { name } } }`,
        { boardId, filter: { labelIds: [urgent] } },
      ).expect(200);
      expect(res.body.data.tasks[0].labels).toEqual([{ name: 'Client' }, { name: 'Urgent' }]);
    });

    it('filters by column', async () => {
      await createTask({ title: 'Todo one' });
      await createTask({ title: 'Doing', status: 'IN_PROGRESS' });
      await createTask({ title: 'Finished', status: 'DONE' });

      expect(await titlesMatching({ statuses: ['TODO', 'DONE'] })).toEqual(['Finished', 'Todo one']);
    });

    it('filters by due date in the user\'s own time zone', async () => {
      const zone = 'Pacific/Kiritimati'; // UTC+14: its "today" is often a different date from the server's
      await gql(SET_TIME_ZONE, { input: { timeZone: zone } }).expect(200);
      await createTask({ title: 'Late', dueDate: dateIn(zone, -1) });
      await createTask({ title: 'Late but done', dueDate: dateIn(zone, -1), status: 'DONE' });
      await createTask({ title: 'Today', dueDate: dateIn(zone, 0) });
      await createTask({ title: 'Undated' });

      expect(await titlesMatching({ due: 'OVERDUE' })).toEqual(['Late']);
      expect(await titlesMatching({ due: 'TODAY' })).toEqual(['Today']);
      expect(await titlesMatching({ due: 'NO_DATE' })).toEqual(['Undated']);
    });

    it('"this week" is Monday to Sunday', async () => {
      const zone = 'Asia/Kuala_Lumpur';
      await gql(SET_TIME_ZONE, { input: { timeZone: zone } }).expect(200);
      const today = new Date(`${dateIn(zone)}T00:00:00Z`);
      const toMonday = -((today.getUTCDay() + 6) % 7);
      await createTask({ title: 'Monday', dueDate: dateIn(zone, toMonday) });
      await createTask({ title: 'Sunday', dueDate: dateIn(zone, toMonday + 6) });
      await createTask({ title: 'Last Sunday', dueDate: dateIn(zone, toMonday - 1) });
      await createTask({ title: 'Next Monday', dueDate: dateIn(zone, toMonday + 7) });

      expect(await titlesMatching({ due: 'THIS_WEEK' })).toEqual(['Monday', 'Sunday']);
    });

    it('combines filters: a task must match all of them', async () => {
      const urgent = await createLabel('Urgent');
      const a = await createTask({ title: 'Report draft' });
      const b = await createTask({ title: 'Report final', status: 'DONE' });
      await createTask({ title: 'Report notes' });
      await labelTask(a.id, [urgent]);
      await labelTask(b.id, [urgent]);

      expect(await titlesMatching({ q: 'report', labelIds: [urgent], statuses: ['TODO'] })).toEqual(['Report draft']);
    });

    it('rejects an unknown due filter or column', async () => {
      const due = await gql(FILTERED, { boardId, filter: { due: 'SOMEDAY' } }).expect(400);
      const status = await gql(FILTERED, { boardId, filter: { statuses: ['DOING'] } }).expect(400);

      expect(due.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
      expect(status.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it("never shows another user's tasks, whatever the filter", async () => {
      await gqlAsOther(CREATE_TASK, { input: { boardId: otherBoardId, title: 'Their secret' } }).expect(200);

      const res = await gqlAsOther(FILTERED, { boardId, filter: { q: 'secret' } }).expect(200);

      expect(res.body.data.tasks).toEqual([]); // my board, their search: nothing of mine, nothing of theirs
    });
  });

  describe('attachments', () => {
    // The first bytes of every PNG file, then anything: enough for the type check
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a png')]);

    // Upload through the normal (non-GraphQL) address, as `who`
    const upload = (taskId: number, content: Buffer, fileName: string, who = cookie) =>
      request(app.getHttpServer())
        .post(`/api/tasks/${taskId}/attachments`)
        .set('Cookie', who)
        .attach('file', content, fileName);

    const download = (id: number, who = cookie) =>
      request(app.getHttpServer())
        .get(`/api/attachments/${id}/download`)
        .set('Cookie', who)
        .buffer(true)
        .parse((res, done) => { // collect the raw bytes, whatever the type
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });

    // Where an attachment's bytes are on disk (the key never leaves the server, so read it from the database)
    const storedPath = async (id: number) => {
      const [row] = await tasksRepository.query('SELECT storage_key FROM attachments WHERE id = $1', [id]);
      return join(process.env.UPLOAD_DIR!, row.storage_key as string);
    };

    it('uploads a file, stores its bytes, and never shows the storage key', async () => {
      const task = await createTask({ title: 'With a file' });

      const res = await upload(task.id, PNG, 'photo.png').expect(201);

      expect(res.body).toMatchObject({ fileName: 'photo.png', mimeType: 'image/png', size: PNG.length, taskId: task.id });
      expect(res.body.storageKey).toBeUndefined();
      expect(await readFile(await storedPath(res.body.id))).toEqual(PNG);
    });

    it('lists a task\'s files, oldest first', async () => {
      const task = await createTask({ title: 'With files' });
      await upload(task.id, PNG, 'first.png').expect(201);
      await upload(task.id, Buffer.from('a,b\n1,2\n'), 'data.csv').expect(201);

      const res = await gql(ATTACHMENTS, { taskId: task.id }).expect(200);

      expect(res.body.data.attachments.map((a: { fileName: string }) => a.fileName)).toEqual(['first.png', 'data.csv']);
      expect(res.body.data.attachments[1].mimeType).toBe('text/csv; charset=utf-8');
    });

    it('downloads the exact bytes, always as a download, with nosniff', async () => {
      const task = await createTask({ title: 'With a file' });
      const uploaded = (await upload(task.id, PNG, 'photo.png').expect(201)).body;

      const res = await download(uploaded.id).expect(200);

      expect(res.body).toEqual(PNG);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toBe('attachment; filename="photo.png"; filename*=UTF-8\'\'photo.png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('keeps non-English file names', async () => {
      const task = await createTask({ title: 'With a file' });

      const uploaded = (await upload(task.id, Buffer.from('bonjour'), 'résumé.txt').expect(201)).body;
      const res = await download(uploaded.id).expect(200);

      expect(uploaded.fileName).toBe('résumé.txt');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="r_sum_.txt"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.txt',
      );
    });

    it('refuses file types that are not on the list (SVG and HTML can carry scripts)', async () => {
      const task = await createTask({ title: 'With a file' });

      for (const [content, name] of [
        ['<svg onload="alert(1)"/>', 'drawing.svg'],
        ['<script>alert(1)</script>', 'page.html'],
        ['MZ...', 'program.exe'],
        ['no extension', 'README'],
      ]) {
        const res = await upload(task.id, Buffer.from(content), name).expect(400);
        expect(res.body.message).toBe(
          "This kind of file can't be attached. Allowed: PNG, JPEG, GIF, WebP, PDF, TXT, CSV, DOCX, XLSX, PPTX, ZIP",
        );
      }
    });

    it('refuses a file whose contents do not match its extension', async () => {
      const task = await createTask({ title: 'With a file' });

      const fakePng = await upload(task.id, Buffer.from('<script>alert(1)</script>'), 'cat.png').expect(400);
      const binaryTxt = await upload(task.id, Buffer.from([0x00, 0x01, 0x02]), 'notes.txt').expect(400);

      expect(fakePng.body.message).toBe("The file's contents don't match its .png extension");
      expect(binaryTxt.body.message).toBe("The file's contents don't match its .txt extension");
    });

    it('refuses an empty file, a missing file, and a file over 10 MB', async () => {
      const task = await createTask({ title: 'With a file' });

      const empty = await upload(task.id, Buffer.alloc(0), 'empty.txt').expect(400);
      const missing = await request(app.getHttpServer())
        .post(`/api/tasks/${task.id}/attachments`).set('Cookie', cookie).field('other', 'x').expect(400);
      const tooBig = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
      await upload(task.id, tooBig, 'huge.png').expect(413);

      expect(empty.body.message).toBe('The file is empty');
      expect(missing.body.message).toBe('No file was sent (it goes in a form field called "file")');
      const left = await gql(ATTACHMENTS, { taskId: task.id }).expect(200);
      expect(left.body.data.attachments).toEqual([]);
    });

    it('needs a login to upload or download', async () => {
      const task = await createTask({ title: 'With a file' });
      const uploaded = (await upload(task.id, PNG, 'photo.png').expect(201)).body;

      await request(app.getHttpServer())
        .post(`/api/tasks/${task.id}/attachments`).attach('file', PNG, 'photo.png').expect(401);
      await request(app.getHttpServer()).get(`/api/attachments/${uploaded.id}/download`).expect(401);
    });

    it("another user can't upload to, list, download or delete my files", async () => {
      const task = await createTask({ title: 'Mine' });
      const uploaded = (await upload(task.id, PNG, 'secret.png').expect(201)).body;

      const add = await upload(task.id, PNG, 'sneaky.png', otherCookie).expect(404);
      const list = await gqlAsOther(ATTACHMENTS, { taskId: task.id }).expect(200);
      const get = await download(uploaded.id, otherCookie).expect(404);
      const remove = await gqlAsOther(DELETE_ATTACHMENT, { id: uploaded.id }).expect(200);

      expect(add.body.message).toBe(`Task ${task.id} not found`);
      expect(list.body.errors[0].message).toBe(`Task ${task.id} not found`);
      expect(JSON.parse(get.body.toString()).message).toBe(`Attachment ${uploaded.id} not found`);
      expect(remove.body.errors[0].message).toBe(`Attachment ${uploaded.id} not found`);
      await download(uploaded.id).expect(200); // still there for me
    });

    it('deleting a file removes it from the list and from storage', async () => {
      const task = await createTask({ title: 'With a file' });
      const uploaded = (await upload(task.id, PNG, 'photo.png').expect(201)).body;
      const path = await storedPath(uploaded.id);

      const res = await gql(DELETE_ATTACHMENT, { id: uploaded.id }).expect(200);

      expect(res.body.data.deleteAttachment).toBe(true);
      expect((await gql(ATTACHMENTS, { taskId: task.id }).expect(200)).body.data.attachments).toEqual([]);
      await expect(readFile(path)).rejects.toThrow(); // the file is gone
    });

    it("cleans up the files of deleted tasks", async () => {
      const task = await createTask({ title: 'Doomed' });
      const kept = await createTask({ title: 'Kept' });
      const doomedFile = await storedPath((await upload(task.id, PNG, 'old.png').expect(201)).body.id);
      const keptFile = await storedPath((await upload(kept.id, PNG, 'keep.png').expect(201)).body.id);
      await gql(DELETE_TASK, { id: task.id }).expect(200); // the row goes (cascade), the file stays

      // The clean-up skips files newer than an hour (they may be mid-upload): make both look 2 hours old
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(doomedFile, twoHoursAgo, twoHoursAgo);
      await utimes(keptFile, twoHoursAgo, twoHoursAgo);
      await app.get(AttachmentsService).removeOrphanFiles();

      await expect(readFile(doomedFile)).rejects.toThrow();
      expect(await readFile(keptFile)).toEqual(PNG);
    });

    it('the board shows how many files each task has', async () => {
      const task = await createTask({ title: 'With files' });
      await createTask({ title: 'Without' });
      await upload(task.id, PNG, 'one.png').expect(201);
      await upload(task.id, PNG, 'two.png').expect(201);

      const res = await gql(`query ($boardId: Int!) { tasks(boardId: $boardId) { title attachmentCount } }`, { boardId })
        .expect(200);

      expect(res.body.data.tasks).toEqual([
        { title: 'With files', attachmentCount: 2 },
        { title: 'Without', attachmentCount: 0 },
      ]);
    });

    it('allows at most 20 files on a task', async () => {
      const task = await createTask({ title: 'Many files' });
      for (let i = 1; i <= 20; i++) await upload(task.id, PNG, `file${i}.png`).expect(201);

      const res = await upload(task.id, PNG, 'one-too-many.png').expect(400);

      expect(res.body.message).toBe('A task can have at most 20 files');
    });
  });

  describe('notes (description)', () => {
    it('accepts 10,000 characters, rejects 10,001', async () => {
      await createTask({ title: 'Long notes', description: 'a'.repeat(10000) });

      const res = await gql(CREATE_TASK, {
        input: { boardId, title: 'Too long', description: 'a'.repeat(10001) },
      }).expect(200);

      expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });
  });

  describe('createTask', () => {
    it('creates a task and trims it', async () => {
      const res = await gql(CREATE_TASK, {
        input: { boardId, title: '   Buy Milk   ', dueDate: '2026-10-05' },
      }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.createTask.title).toBe('Buy Milk');
      expect(res.body.data.createTask.status).toBe('TODO'); // enum NAME, not 'todo'
      expect(res.body.data.createTask.id).toBeDefined();
    });

    it('rejects an empty title', async () => {
      const res = await gql(CREATE_TASK, { input: { boardId, title: '' } }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].extensions.originalError.message).toContain(
        'title should not be empty',
      );
    });

    it('rejects a title of only spaces', async () => {
      const res = await gql(CREATE_TASK, { input: { boardId, title: '   ' } }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].extensions.originalError.message).toContain(
        'title should not be empty',
      );
    });

    it('rejects an unknown status', async () => {
      const res = await gql(CREATE_TASK, {
        input: { boardId, title: 'x', status: 'DOING' },
      }).expect(400);

      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('rejects an impossible date', async () => {
      const res = await gql(CREATE_TASK, {
        input: { boardId, title: 'x', dueDate: '2026-02-30' },
      }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });

    it('rejects unknown fields', async () => {
      const res = await gql(CREATE_TASK, {
        input: { boardId, title: 'x', priority: 'high' },
      }).expect(400);

      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('accepts 100 characters, rejects 101', async () => {
      await createTask({ title: 'a'.repeat(100) });

      const res = await gql(CREATE_TASK, {
        input: { boardId, title: 'a'.repeat(101) },
      }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });
  });

  describe('tasks query', () => {
    it('returns tasks in creation order', async () => {
      await createTask({ title: 'First' });
      await createTask({ title: 'Second' });

      const res = await gql(TASKS, { boardId }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.tasks.map((t: { title: string }) => t.title)).toEqual([
        'First',
        'Second',
      ]);
    });

    it('returns only the fields that were asked for', async () => {
      await createTask({ title: 'Only id please' });

      const res = await gql(`query ($boardId: Int!) { tasks(boardId: $boardId) { id } }`, {
        boardId,
      }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.tasks[0].id).toBeDefined();
      expect(res.body.data.tasks[0].title).toBeUndefined();
    });
  });

  describe('updateTask', () => {
    it('changes the status and keeps the other fields', async () => {
      const created = await createTask({ title: 'Write report' });

      const res = await gql(UPDATE_TASK, {
        id: created.id,
        input: { status: 'IN_PROGRESS' },
      }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.updateTask.status).toBe('IN_PROGRESS');
      expect(res.body.data.updateTask.title).toBe('Write report');
    });

    it('rejects an unknown status', async () => {
      const created = await createTask({ title: 'Write report' });

      const res = await gql(UPDATE_TASK, {
        id: created.id,
        input: { status: 'DOING' },
      }).expect(400);

      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('returns an error for a task that doesnt exist', async () => {
      const res = await gql(UPDATE_TASK, {
        id: 999999,
        input: { status: 'DONE' },
      }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].message).toContain('Task 999999 not found');
    });

    it('rejects a non-numeric id', async () => {
      const res = await gql(UPDATE_TASK, {
        id: 'abc',
        input: { status: 'DONE' },
      }).expect(400);

      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    it('clears the due date when it is set to null (the calendar\'s "No due date")', async () => {
      const created = await createTask({ title: 'Dated', dueDate: '2026-10-20' });

      const res = await gql(
        `mutation ($id: Int!, $input: UpdateTaskInput!) { updateTask(id: $id, input: $input) { dueDate } }`,
        { id: created.id, input: { dueDate: null } },
      ).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.updateTask.dueDate).toBeNull();
    });

    it('rejects a null title', async () => {
      const created = await createTask({ title: 'Write report' });

      // The schema and ValidationPipe both allow null here; the service is what stops it
      const res = await gql(UPDATE_TASK, {
        id: created.id,
        input: { title: null },
      }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].message).toContain('cannot be null');
    });
  });

  describe('moveTask', () => {
    it('moves a task up inside its column', async () => {
      await createTask({ title: 'A' });
      await createTask({ title: 'B' });
      const c = await createTask({ title: 'C' });

      const res = await gql(MOVE_TASK, {
        id: c.id,
        input: { status: 'TODO', position: 0 },
      }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(await titlesIn('TODO')).toEqual(['C', 'A', 'B']);
    });

    it('moves a task down inside its column', async () => {
      const a = await createTask({ title: 'A' });
      await createTask({ title: 'B' });
      await createTask({ title: 'C' });

      await gql(MOVE_TASK, { id: a.id, input: { status: 'TODO', position: 2 } }).expect(200);

      expect(await titlesIn('TODO')).toEqual(['B', 'C', 'A']);
    });

    it('moves a task between two tasks of another column', async () => {
      const a = await createTask({ title: 'A' });
      await createTask({ title: 'B' });
      await createTask({ title: 'X', status: 'DONE' });
      await createTask({ title: 'Y', status: 'DONE' });

      const res = await gql(MOVE_TASK, {
        id: a.id,
        input: { status: 'DONE', position: 1 },
      }).expect(200);

      expect(res.body.data.moveTask.status).toBe('DONE');
      expect(await titlesIn('DONE')).toEqual(['X', 'A', 'Y']);
      expect(await titlesIn('TODO')).toEqual(['B']);
    });

    it('puts a task at the bottom when the position is past the end', async () => {
      const a = await createTask({ title: 'A' });
      await createTask({ title: 'X', status: 'DONE' });

      await gql(MOVE_TASK, { id: a.id, input: { status: 'DONE', position: 99 } }).expect(200);

      expect(await titlesIn('DONE')).toEqual(['X', 'A']);
    });

    it('adds new tasks at the bottom of their column', async () => {
      await createTask({ title: 'A' });
      const b = await createTask({ title: 'B' });
      await gql(MOVE_TASK, { id: b.id, input: { status: 'TODO', position: 0 } }).expect(200);

      await createTask({ title: 'C' });

      expect(await titlesIn('TODO')).toEqual(['B', 'A', 'C']);
    });

    it('puts a task at the bottom of the new column when its status is changed', async () => {
      await createTask({ title: 'X', status: 'DONE' });
      const a = await createTask({ title: 'A' });

      await gql(UPDATE_TASK, { id: a.id, input: { status: 'DONE' } }).expect(200);

      expect(await titlesIn('DONE')).toEqual(['X', 'A']);
    });

    it('rejects a negative position', async () => {
      const a = await createTask({ title: 'A' });

      const res = await gql(MOVE_TASK, {
        id: a.id,
        input: { status: 'TODO', position: -1 },
      }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    });

    it('returns an error for a task that doesnt exist', async () => {
      const res = await gql(MOVE_TASK, {
        id: 999999,
        input: { status: 'TODO', position: 0 },
      }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].message).toContain('Task 999999 not found');
    });
  });

  describe('deleteTask', () => {
    it('deletes a task', async () => {
      const created = await createTask({ title: 'Write report' });

      const res = await gql(DELETE_TASK, { id: created.id }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.deleteTask).toBe(true);

      const after = await gql(TASKS, { boardId }).expect(200);
      expect(after.body.data.tasks).toHaveLength(0);
    });

    it('returns an error for a task that doesnt exist', async () => {
      const res = await gql(DELETE_TASK, { id: 999999 }).expect(200);

      expect(res.body.data).toBeNull();
      expect(res.body.errors[0].message).toContain('Task 999999 not found');
    });

    it('rejects a non-numeric id', async () => {
      const res = await gql(DELETE_TASK, { id: 'abc' }).expect(400);

      expect(res.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });
  });

  describe('profile: task numbers', () => {
    const STATS = `query { taskStats { total todo inProgress done overdue dueThisWeek doneThisWeek } }`;
    const stats = async (who = cookie) => {
      const res = await gqlAs(who, STATS).expect(200);
      expect(res.body.errors).toBeUndefined();
      return res.body.data.taskStats;
    };

    it('counts across all your boards: per column, overdue, due this week and finished this week', async () => {
      const work = (await gql(CREATE_BOARD, { input: { name: 'Work' } }).expect(200)).body.data.createBoard;
      await createTask({ title: 'Late', dueDate: '2000-01-01' }); // overdue (TEST_USER has no time zone: UTC)
      await createTask({ title: 'Today', dueDate: todayIn(null) }); // due this week
      await createTask({ title: 'Started', boardId: work.id, status: 'IN_PROGRESS' });
      const finished = await createTask({ title: 'Finished', boardId: work.id });
      await gql(MOVE_TASK, { id: finished.id, input: { status: 'DONE', position: 0 } }).expect(200);

      expect(await stats()).toEqual({
        total: 4, todo: 2, inProgress: 1, done: 1, overdue: 1, dueThisWeek: 1, doneThisWeek: 1,
      });
      expect((await stats(otherCookie)).total).toBe(0); // only your own tasks
    });

    it('a task that leaves Done no longer counts as finished; one added straight to Done does', async () => {
      const task = await createTask({ title: 'Back and forth' });
      await gql(MOVE_TASK, { id: task.id, input: { status: 'DONE', position: 0 } }).expect(200);
      await gql(MOVE_TASK, { id: task.id, input: { status: 'TODO', position: 0 } }).expect(200);
      expect((await stats()).doneThisWeek).toBe(0);

      await createTask({ title: 'Already done', status: 'DONE' });
      expect((await stats()).doneThisWeek).toBe(1);
    });
  });

  describe('profile: display name', () => {
    const SET_NAME = `
      mutation SetDisplayName($input: DisplayNameInput!) { setDisplayName(input: $input) { id displayName } }
    `;
    const NAME_USER = { email: 'e2e-name@test.com', password: 'e2e-password' };

    it('saves a trimmed name, shows it on your comments, and an empty one removes it', async () => {
      const session = await registerAndLogIn(NAME_USER);
      const named = await gqlAs(session, SET_NAME, { input: { displayName: '  Sam Lee  ' } }).expect(200);
      expect(named.body.data.setDisplayName.displayName).toBe('Sam Lee');
      expect((await gqlAs(session, `query { me { displayName } }`).expect(200)).body.data.me.displayName).toBe('Sam Lee');

      const sessionBoard = (await gqlAs(session, BOARDS).expect(200)).body.data.boards[0].id;
      const task = (await gqlAs(session, CREATE_TASK, { input: { boardId: sessionBoard, title: 'Notes' } }).expect(200))
        .body.data.createTask;
      const comment = await gqlAs(session, `
        mutation { addComment(taskId: ${task.id}, input: { body: "Hi" }) { author { email displayName } } }
      `).expect(200);
      expect(comment.body.data.addComment.author).toEqual({ email: NAME_USER.email, displayName: 'Sam Lee' });

      const cleared = await gqlAs(session, SET_NAME, { input: { displayName: '   ' } }).expect(200);
      expect(cleared.body.data.setDisplayName.displayName).toBeNull();
    });

    it('refuses names that are too long or contain invisible characters', async () => {
      const session = await registerAndLogIn(NAME_USER);

      const tooLong = await gqlAs(session, SET_NAME, { input: { displayName: 'x'.repeat(51) } }).expect(200);
      const hidden = await gqlAs(session, SET_NAME, { input: { displayName: 'Sam​Lee' } }).expect(200);

      expect(tooLong.body.errors[0].extensions.originalError.message).toContain(
        'displayName must be shorter than or equal to 50 characters',
      );
      expect(hidden.body.errors[0].extensions.originalError.message).toContain(
        "The name can't contain invisible or control characters",
      );
    });
  });

  describe('profile: delete account', () => {
    const DELETE_ACCOUNT = `mutation DeleteAccount($input: DeleteAccountInput!) { deleteAccount(input: $input) }`;
    const DOOMED_USER = { email: 'e2e-delete@test.com', password: 'e2e-password' };
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a png')]);

    it('keeps everything when the password is wrong', async () => {
      const session = await registerAndLogIn(DOOMED_USER);

      const res = await gqlAs(session, DELETE_ACCOUNT, { input: { password: 'not-my-password' } }).expect(200);

      expect(res.body.errors[0].message).toBe('Password is incorrect');
      expect(res.body.errors[0].extensions.code).not.toBe('UNAUTHENTICATED'); // so the app doesn't log you out
      expect(await usersRepository.countBy({ email: DOOMED_USER.email })).toBe(1);
    });

    it('deletes the account, its boards, tasks and files, and logs it out', async () => {
      const session = await registerAndLogIn(DOOMED_USER);
      const userId = (await gqlAs(session, `query { me { id } }`).expect(200)).body.data.me.id;
      const sessionBoard = (await gqlAs(session, BOARDS).expect(200)).body.data.boards[0].id;
      const task = (await gqlAs(session, CREATE_TASK, { input: { boardId: sessionBoard, title: 'Mine' } }).expect(200))
        .body.data.createTask;
      const uploaded = (await request(app.getHttpServer())
        .post(`/api/tasks/${task.id}/attachments`).set('Cookie', session).attach('file', PNG, 'photo.png').expect(201)).body;
      const [row] = await tasksRepository.query('SELECT storage_key FROM attachments WHERE id = $1', [uploaded.id]);
      const filePath = join(process.env.UPLOAD_DIR!, row.storage_key as string);

      const res = await gqlAs(session, DELETE_ACCOUNT, { input: { password: DOOMED_USER.password } }).expect(200);

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.deleteAccount).toBe(true);
      expect(String(res.headers['set-cookie'])).toContain(`${AUTH_COOKIE}=;`); // the browser removes the login cookie
      expect(await usersRepository.countBy({ id: userId })).toBe(0);
      expect(await boardsRepository.countBy({ ownerId: userId })).toBe(0);
      expect(await tasksRepository.countBy({ ownerId: userId })).toBe(0);
      await expect(readFile(filePath)).rejects.toThrow(); // the uploaded file is gone from the disk too

      const after = await gqlAs(session, `query { me { id } }`).expect(200); // the old cookie no longer works
      expect(after.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('Claude runner', () => {
    const SET_PROJECT = `
      mutation SetBoardProject($id: Int!, $input: BoardProjectInput!) { setBoardProject(id: $id, input: $input) { id project } }
    `;
    const NEXT_JOB = `
      query { runnerNextJob { kind project approvedPrompt task { id status } comments { body fromRunner } checklist { text } } }
    `;
    const SAVE_PROMPT = `
      mutation ($taskId: Int!, $input: RunnerPromptInput!) { runnerSavePrompt(taskId: $taskId, input: $input) { id status refinedPrompt changesRequested } }
    `;
    const START_BUILD = `
      mutation ($taskId: Int!, $input: RunnerBuildStartInput!) { runnerStartBuild(taskId: $taskId, input: $input) { id aiBranch } }
    `;
    const FINISH_BUILD = `
      mutation ($taskId: Int!, $input: RunnerBuildResultInput!) { runnerFinishBuild(taskId: $taskId, input: $input) { id status aiChecksPassed } }
    `;
    const REPORT_ERROR = `
      mutation ($taskId: Int!, $input: RunnerErrorInput!) { runnerReportError(taskId: $taskId, input: $input) { id aiError } }
    `;
    const EDIT_PROMPT = `
      mutation ($taskId: Int!, $input: RefinedPromptInput!) { updateRefinedPrompt(taskId: $taskId, input: $input) { id refinedPrompt } }
    `;
    const APPROVE = `mutation ($taskId: Int!) { approvePrompt(taskId: $taskId) { id status promptApprovedAt } }`;
    const REQUEST_CHANGES = `
      mutation ($taskId: Int!, $input: PromptChangesInput!) { requestPromptChanges(taskId: $taskId, input: $input) { id status changesRequested } }
    `;
    const RETRY = `mutation ($taskId: Int!) { retryAiTask(taskId: $taskId) { id aiError } }`;
    const RUNNER_COMMENTS = `query ($taskId: Int!) { comments(taskId: $taskId) { id body fromRunner } }`;
    const AI_NOTES = `query ($taskId: Int!) { aiNotes(taskId: $taskId) { id body kind fromRunner } }`;
    const NOTIFICATIONS = `
      query { notifications { id kind message readAt task { id title boardId } } unreadNotificationCount }
    `;
    type Bell = {
      notifications: { id: number; kind: string; message: string; readAt: string | null; task: { id: number } | null }[];
      unreadNotificationCount: number;
    };

    let token: string;

    // As the runner: its token in the Authorization header, no cookie
    const asRunner = (query: string, variables?: Record<string, unknown>, bearer = token) =>
      request(app.getHttpServer()).post('/graphql').set('Authorization', `Bearer ${bearer}`).send({ query, variables });

    const ok = async (pending: Promise<{ body: { data: Record<string, unknown>; errors?: { message: string }[] } }>) => {
      const res = await pending;
      expect(res.body.errors).toBeUndefined();
      return res.body.data;
    };
    const nextJob = async () => (await ok(asRunner(NEXT_JOB))).runnerNextJob as {
      kind: string; project: string; approvedPrompt: string | null; task: { id: number; status: string };
      comments: { body: string; fromRunner: boolean }[]; checklist: { text: string }[];
    } | null;

    // A board with a project, and a task on it with the "AI" label
    const aiTask = async (title = 'Add a search box', { project = 'notes-app', label = 'AI' } = {}) => {
      const board = (await gql(CREATE_BOARD, { input: { name: 'Runner board' } }).expect(200)).body.data.createBoard;
      await gql(SET_PROJECT, { id: board.id, input: { project } }).expect(200);
      const created = (await gql(CREATE_LABEL, { boardId: board.id, input: { name: label, color: 'TEAL' } }).expect(200)).body.data.createLabel;
      const task = await createTask({ title, boardId: board.id });
      await gql(SET_TASK_LABELS, { taskId: task.id, input: { labelIds: [created.id] } }).expect(200);
      return { task, board };
    };

    beforeAll(async () => {
      token = (await gql(`mutation { createRunnerToken }`).expect(200)).body.data.createRunnerToken;
    });

    it('a board project must be a plain name, never a path', async () => {
      const board = (await gql(CREATE_BOARD, { input: { name: 'Projects' } }).expect(200)).body.data.createBoard;

      const named = await gql(SET_PROJECT, { id: board.id, input: { project: '  Notes-App ' } }).expect(200);
      const path = await gql(SET_PROJECT, { id: board.id, input: { project: '../../etc' } }).expect(200);
      const cleared = await gql(SET_PROJECT, { id: board.id, input: { project: '' } }).expect(200);

      expect(named.body.data.setBoardProject.project).toBe('notes-app');
      expect(path.body.errors[0].extensions.originalError.message[0]).toContain('Use a project name from the runner');
      expect(cleared.body.data.setBoardProject.project).toBeNull();
    });

    it('the runner token only works for the runner, and a revoked token stops working', async () => {
      expect((await ok(asRunner(`query { runnerPing }`))).runnerPing).toBe(true);

      const asTasks = await asRunner(TASKS, { boardId }).expect(200); // a normal operation with the runner token
      expect(asTasks.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
      const withCookie = await gql(`query { runnerPing }`).expect(200); // and the runner's operations need the token
      expect(withCookie.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
      const madeUp = await asRunner(`query { runnerPing }`, undefined, 'tbr_made-up').expect(200);
      expect(madeUp.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');

      const info = (await ok(gql(`query { runnerToken { createdAt lastUsedAt } }`))).runnerToken as { lastUsedAt: string };
      expect(info.lastUsedAt).not.toBeNull();

      await ok(gql(`mutation { revokeRunnerToken }`));
      const revoked = await asRunner(`query { runnerPing }`).expect(200);
      expect(revoked.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
      token = (await gql(`mutation { createRunnerToken }`).expect(200)).body.data.createRunnerToken; // for the next tests
    });

    it('only picks up "AI" tasks on boards with a project', async () => {
      await createTask({ title: 'Not for Claude' }); // no label
      await aiTask('No project', { project: '' });
      expect(await nextJob()).toBeNull();

      const { task } = await aiTask('For Claude', { label: 'ai' }); // any capitals
      const job = await nextJob();
      expect(job).toMatchObject({ kind: 'REFINE', project: 'notes-app', task: { id: task.id, status: 'TODO' } });
    });

    it("the assistant reads Claude's work and reviews its prompt, on the current board only", async () => {
      const toolNamed = (name: string) => fakeLlm.lastTools.find((t) => t.name === name)!;
      const { task, board } = await aiTask();
      const home = await createTask({ title: 'Home task' });
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Goal: a search box on the board page.' } }));
      await gql(SEND_CHAT, { input: { boardId: board.id, message: 'How is the search task going?' } }).expect(200);

      const details = await toolNamed('get_ai_details').run({ ids: [task.id, home.id] });
      expect(details).toContain('Goal: a search box on the board page.');
      expect(details).toContain(`Task #${home.id}: Task ${home.id} not found on this board`);

      // Request changes: the feedback is saved like the button's, and the task waits for Claude's revision
      await toolNamed('request_prompt_changes').run({ id: task.id, comment: 'Put it in the header' });
      const notes = (await ok(gql(AI_NOTES, { taskId: task.id }))).aiNotes as { body: string; kind: string }[];
      expect(notes).toEqual([expect.objectContaining({ body: 'Put it in the header', kind: 'feedback' })]);
      await expect(toolNamed('approve_prompt').run({ id: task.id })).rejects.toThrow('Claude is still revising this prompt');

      // Claude revises it, then the assistant approves it: the task goes to In progress, ready to build
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Goal: a search box in the header.' } }));
      await toolNamed('approve_prompt').run({ id: task.id });
      expect(await titlesIn('IN_PROGRESS', board.id)).toEqual(['Add a search box']);
      expect(await nextJob()).toMatchObject({ kind: 'BUILD', approvedPrompt: 'Goal: a search box in the header.' });

      await expect(toolNamed('approve_prompt').run({ id: home.id })).rejects.toThrow(`Task ${home.id} not found on this board`);
    });

    it('runs the whole flow: prompt, review, approve, build, AI Review', async () => {
      const { task } = await aiTask();

      // 1. The runner writes the prompt: the task goes to Prompt Review, with a comment from Claude
      const saved = (await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Goal: search. [[FILL IN: which page?]]' } })))
        .runnerSavePrompt as { status: string };
      expect(saved.status).toBe('PROMPT_REVIEW');
      expect(await nextJob()).toBeNull(); // nothing to do until you've reviewed it

      // 2. You can't approve it with a blank left, and approving is the only way to a build
      const blank = await gql(APPROVE, { taskId: task.id }).expect(200);
      expect(blank.body.errors[0].message).toContain('Fill in the [[FILL IN: …]] blanks');
      const early = await asRunner(START_BUILD, { taskId: task.id, input: { branch: `ai/task-${task.id}-search` } }).expect(200);
      expect(early.body.errors[0].message).toContain("isn't waiting for this step");

      // 3. You fill in the blank and approve: the task moves to In progress, and THIS text gets built
      await ok(gql(EDIT_PROMPT, { taskId: task.id, input: { prompt: 'Goal: search on the notes page.' } }));
      const approved = (await ok(gql(APPROVE, { taskId: task.id }))).approvePrompt as { status: string; promptApprovedAt: string };
      expect(approved).toMatchObject({ status: 'IN_PROGRESS' });
      expect(approved.promptApprovedAt).not.toBeNull();
      const job = await nextJob();
      expect(job).toMatchObject({ kind: 'BUILD', approvedPrompt: 'Goal: search on the notes page.' });

      // 4. The branch name is checked, and once started the task isn't handed out again
      const badBranch = await asRunner(START_BUILD, { taskId: task.id, input: { branch: 'main' } }).expect(200);
      expect(badBranch.body.errors[0].extensions.originalError.message[0]).toContain('ai/task-12-short-title');
      await ok(asRunner(START_BUILD, { taskId: task.id, input: { branch: `ai/task-${task.id}-search` } }));
      expect(await nextJob()).toBeNull();

      // 5. Finished: AI Review
      const finished = (await ok(asRunner(FINISH_BUILD, { taskId: task.id, input: { checksPassed: true } })))
        .runnerFinishBuild as { status: string; aiChecksPassed: boolean };
      expect(finished).toMatchObject({ status: 'AI_REVIEW', aiChecksPassed: true });

      // 6. Claude doesn't write comments: the bell tells you what needs you (newest first)
      expect((await ok(gql(RUNNER_COMMENTS, { taskId: task.id }))).comments).toEqual([]);
      const bell = (await ok(gql(NOTIFICATIONS))) as Bell;
      expect(bell.notifications.map((n) => [n.kind, n.message, n.task?.id])).toEqual([
        ['review_ready', 'Ready for review', task.id],
        ['prompt_ready', 'Prompt ready for approval', task.id],
      ]);
      expect(bell.unreadNotificationCount).toBe(2);
    });

    it('Merge: you ask after checking the build, the runner merges it, and the task is Done', async () => {
      const MERGE = `mutation ($taskId: Int!) { requestAiMerge(taskId: $taskId) { id status aiMergeRequestedAt } }`;
      const NEXT_ANY = `query { runnerNextJob(kinds: [MERGE, BUILD, REFINE]) { kind task { id aiBranch } } }`;
      const FINISH_MERGE = `mutation ($taskId: Int!) { runnerFinishMerge(taskId: $taskId) { id status aiMergedAt } }`;
      const { task } = await aiTask();
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Goal: search.' } }));
      await ok(gql(APPROVE, { taskId: task.id }));
      const early = await gql(MERGE, { taskId: task.id }).expect(200); // nothing built yet
      expect(early.body.errors[0].message).toBe('Only a built task in AI Review can be merged');
      await ok(asRunner(START_BUILD, { taskId: task.id, input: { branch: `ai/task-${task.id}-search` } }));
      await ok(asRunner(FINISH_BUILD, { taskId: task.id, input: { checksPassed: true } }));
      // Finishing a merge nobody asked for is refused
      const unasked = await asRunner(FINISH_MERGE, { taskId: task.id }).expect(200);
      expect(unasked.body.errors[0].message).toBe(`Task ${task.id} isn't waiting for this step`);

      // You click Merge. A runner from before merges existed (no kinds) is never handed it; a new one is.
      const asked = (await ok(gql(MERGE, { taskId: task.id }))).requestAiMerge as { status: string; aiMergeRequestedAt: string };
      expect(asked.status).toBe('AI_REVIEW');
      expect(asked.aiMergeRequestedAt).not.toBeNull();
      expect(await nextJob()).toBeNull();
      expect((await ok(asRunner(NEXT_ANY))).runnerNextJob).toEqual({ kind: 'MERGE', task: { id: task.id, aiBranch: `ai/task-${task.id}-search` } });

      // Merged: Done, and the bell says so
      const merged = (await ok(asRunner(FINISH_MERGE, { taskId: task.id }))).runnerFinishMerge as { status: string; aiMergedAt: string };
      expect(merged.status).toBe('DONE');
      expect(merged.aiMergedAt).not.toBeNull();
      expect((await ok(asRunner(NEXT_ANY))).runnerNextJob).toBeNull();
      const bell = (await ok(gql(NOTIFICATIONS))) as Bell;
      expect(bell.notifications[0]).toMatchObject({ kind: 'merged', message: 'Merged into the project', task: { id: task.id } });
    });

    it("a build whose checks failed can't be merged from the board", async () => {
      const { task } = await aiTask();
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Goal: search.' } }));
      await ok(gql(APPROVE, { taskId: task.id }));
      await ok(asRunner(START_BUILD, { taskId: task.id, input: { branch: `ai/task-${task.id}-search` } }));
      await ok(asRunner(FINISH_BUILD, { taskId: task.id, input: { checksPassed: false } }));

      const res = await gql(`mutation ($taskId: Int!) { requestAiMerge(taskId: $taskId) { id } }`, { taskId: task.id }).expect(200);
      expect(res.body.errors[0].message).toBe("This build's checks didn't pass: merge it by hand if you still want it");
    });

    it('a built task moved back to In progress is built again, from scratch on a new branch', async () => {
      const { task } = await aiTask();
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Goal: search.' } }));
      await ok(gql(APPROVE, { taskId: task.id }));
      await ok(asRunner(START_BUILD, { taskId: task.id, input: { branch: `ai/task-${task.id}-search` } }));

      // While it's being built, moving it within In progress doesn't hand it out again
      await gql(MOVE_TASK, { id: task.id, input: { status: 'IN_PROGRESS', position: 0 } }).expect(200);
      expect(await nextJob()).toBeNull();
      await ok(asRunner(FINISH_BUILD, { taskId: task.id, input: { checksPassed: true } }));

      // Into In progress and straight back out before the runner looks: nothing happens
      await gql(MOVE_TASK, { id: task.id, input: { status: 'IN_PROGRESS', position: 0 } }).expect(200);
      await gql(MOVE_TASK, { id: task.id, input: { status: 'AI_REVIEW', position: 0 } }).expect(200);
      expect(await nextJob()).toBeNull();

      // Moved back to In progress: built again from the same approved prompt, on a new branch
      await gql(MOVE_TASK, { id: task.id, input: { status: 'IN_PROGRESS', position: 0 } }).expect(200);
      expect(await nextJob()).toMatchObject({ kind: 'BUILD', approvedPrompt: 'Goal: search.', task: { id: task.id } });
      const notStarted = await asRunner(FINISH_BUILD, { taskId: task.id, input: { checksPassed: true } }).expect(200);
      expect(notStarted.body.errors[0].message).toContain("isn't being built");

      const restarted = (await ok(asRunner(START_BUILD, { taskId: task.id, input: { branch: `ai/task-${task.id}-search-2` } })))
        .runnerStartBuild as { aiBranch: string };
      expect(restarted.aiBranch).toBe(`ai/task-${task.id}-search-2`);
      expect(await nextJob()).toBeNull();
      const finished = (await ok(asRunner(FINISH_BUILD, { taskId: task.id, input: { checksPassed: true } })))
        .runnerFinishBuild as { status: string };
      expect(finished.status).toBe('AI_REVIEW');
    });

    it('"Request changes" keeps the task in Prompt Review and Claude revises it', async () => {
      const { task } = await aiTask();
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'First try' } }));

      const asked = (await ok(gql(REQUEST_CHANGES, { taskId: task.id, input: { comment: 'Use the existing search helper' } })))
        .requestPromptChanges as { status: string; changesRequested: boolean };
      expect(asked).toEqual({ id: task.id, status: 'PROMPT_REVIEW', changesRequested: true });

      const job = await nextJob();
      expect(job?.kind).toBe('REFINE');
      expect(job?.comments.map((c) => c.body)).toContain('Use the existing search helper');
      expect((await ok(gql(RUNNER_COMMENTS, { taskId: task.id }))).comments).toEqual([]);

      const revised = (await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Second try' } }))).runnerSavePrompt;
      expect(revised).toMatchObject({ status: 'PROMPT_REVIEW', refinedPrompt: 'Second try', changesRequested: false });
    });

    it('a task the runner stopped on is skipped until you click "Try again"', async () => {
      const { task } = await aiTask();
      await ok(asRunner(REPORT_ERROR, { taskId: task.id, input: { message: 'The spend cap for this step was reached' } }));
      expect(await nextJob()).toBeNull();

      await ok(gql(RETRY, { taskId: task.id }));
      expect((await nextJob())?.task.id).toBe(task.id);
    });

    it("your prompt feedback and Claude's old notes are in the AI tab, not under Comments, and can't be edited", async () => {
      const { task } = await aiTask();
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'A prompt' } }));
      await ok(gql(REQUEST_CHANGES, { taskId: task.id, input: { comment: 'Shorter please' } }));
      // A note from before the runner had its own log (it doesn't write comments any more)
      await tasksRepository.query(
        `INSERT INTO comments (task_id, author_id, body, kind) SELECT id, owner_id, 'I wrote a prompt', 'claude' FROM tasks WHERE id = $1`,
        [task.id],
      );

      expect((await ok(gql(RUNNER_COMMENTS, { taskId: task.id }))).comments).toEqual([]);
      const notes = (await ok(gql(AI_NOTES, { taskId: task.id }))).aiNotes as { id: number; body: string; kind: string; fromRunner: boolean }[];
      expect(notes.map((n) => [n.kind, n.body, n.fromRunner])).toEqual([
        ['feedback', 'Shorter please', false],
        ['claude', 'I wrote a prompt', true],
      ]);
      for (const note of notes) {
        const res = await gql(UPDATE_COMMENT, { id: note.id, input: { body: 'Rewritten' } }).expect(200);
        expect(res.body.errors[0].message).toBe(note.kind === 'claude' ? "Claude's comments can't be edited" : "Prompt feedback can't be edited");
      }
      const asOther = await gqlAsOther(AI_NOTES, { taskId: task.id }).expect(200);
      expect(asOther.body.errors[0].message).toBe(`Task ${task.id} not found`);
    });

    it('opens a run when a step starts, logs it step by step with secrets hidden, and closes it', async () => {
      const { task } = await aiTask();
      const START_RUN = `mutation ($taskId: Int!, $input: RunnerRunStartInput!) { runnerStartRun(taskId: $taskId, input: $input) }`;
      const APPEND = `mutation ($runId: Int!, $input: RunnerLogInput!) { runnerAppendLog(runId: $runId, input: $input) }`;
      const FINISH_RUN = `mutation ($runId: Int!, $input: RunnerRunFinishInput!) { runnerFinishRun(runId: $runId, input: $input) }`;
      const RUNS = `query ($taskId: Int!) { agentRuns(taskId: $taskId) { id step status result project costUsd summary finishedAt } }`;
      const ACTIVITY = `query ($status: String) { aiRuns(status: $status) { id status result task { id title boardId } } }`;
      const LOG = `query ($runId: Int!) { agentRunLog(runId: $runId) { kind text } }`;
      const at = new Date().toISOString();

      const runId = (await ok(asRunner(START_RUN, { taskId: task.id, input: { step: 'build', branch: `ai/task-${task.id}-search` } })))
        .runnerStartRun as number;
      expect((await ok(gql(ACTIVITY, { status: 'running' }))).aiRuns).toEqual([
        { id: runId, status: 'running', result: 'running', task: { id: task.id, title: 'Add a search box', boardId: expect.any(Number) } },
      ]);

      await ok(asRunner(APPEND, { runId, input: { lines: [
        { at, kind: 'claude', text: "I'll add the search box." },
        { at, kind: 'tool', text: `Ran cat .env → ANTHROPIC_API_KEY=sk-ant-api03-${'x'.repeat(30)}` },
        { at, kind: 'tool', text: 'DATABASE_URL=postgres://app:hunter2secret@localhost/db' },
      ] } }));
      await ok(asRunner(FINISH_RUN, {
        runId, input: { status: 'succeeded', result: 'built', checksPassed: true, costUsd: 0.07, summary: 'Added it. JWT_SECRET=abc123' },
      }));

      expect((await ok(gql(LOG, { runId }))).agentRunLog).toEqual([
        { kind: 'claude', text: "I'll add the search box." },
        { kind: 'tool', text: 'Ran cat .env → ANTHROPIC_API_KEY=[hidden]' },
        { kind: 'tool', text: 'DATABASE_URL=postgres://app:[hidden]@localhost/db' },
      ]);
      const [run] = (await ok(gql(RUNS, { taskId: task.id }))).agentRuns as { finishedAt: string | null }[];
      expect(run).toMatchObject({
        id: runId, step: 'build', status: 'succeeded', result: 'built', project: 'notes-app', costUsd: 0.07,
        summary: 'Added it. JWT_SECRET=[hidden]',
      });
      expect(run.finishedAt).not.toBeNull();
      expect((await ok(gql(ACTIVITY, { status: 'failed' }))).aiRuns).toEqual([]);

      // A finished run takes no more lines, nobody else can read it, and nonsense is refused
      const late = await asRunner(APPEND, { runId, input: { lines: [{ at, kind: 'info', text: 'late' }] } }).expect(200);
      expect(late.body.errors[0].message).toBe(`Run ${runId} has already finished`);
      const asOther = await gqlAsOther(LOG, { runId }).expect(200);
      expect(asOther.body.errors[0].message).toBe(`Run ${runId} not found`);
      const badStep = await asRunner(START_RUN, { taskId: task.id, input: { step: 'deploy' } }).expect(200);
      expect(badStep.body.errors[0].extensions.originalError.message[0]).toContain('step must be one of');
      const badStatus = await gql(ACTIVITY, { status: 'weird' }).expect(200);
      expect(badStatus.body.errors[0].message).toContain('status must be one of');
    });

    it('the bell: failed builds and stops, read one at a time or all at once, only ever yours', async () => {
      const { task } = await aiTask();
      const MARK = `mutation ($id: Int!) { markNotificationRead(id: $id) { id readAt } }`;
      await ok(asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Goal' } }));
      await ok(gql(APPROVE, { taskId: task.id }));
      await ok(asRunner(START_BUILD, { taskId: task.id, input: { branch: `ai/task-${task.id}-x` } }));
      const finished = (await ok(asRunner(FINISH_BUILD, { taskId: task.id, input: { checksPassed: false } }))).runnerFinishBuild;
      expect(finished).toMatchObject({ status: 'AI_REVIEW', aiChecksPassed: false }); // the card shows Failed
      await ok(asRunner(REPORT_ERROR, { taskId: task.id, input: { message: 'The spend cap for this step was reached' } }));

      const bell = (await ok(gql(NOTIFICATIONS))) as Bell;
      expect(bell.notifications.map((n) => [n.kind, n.message])).toEqual([
        ['run_failed', 'Claude stopped: The spend cap for this step was reached'],
        ['run_failed', 'Built, but it needs a look: the checks failed or Claude stopped early'],
        ['prompt_ready', 'Prompt ready for approval'],
      ]);
      expect(bell.unreadNotificationCount).toBe(3);

      const newest = bell.notifications[0].id;
      const asOther = await gqlAsOther(MARK, { id: newest }).expect(200);
      expect(asOther.body.errors[0].message).toBe(`Notification ${newest} not found`);
      expect(((await ok(gqlAsOther(NOTIFICATIONS))) as Bell).notifications).toEqual([]);

      const marked = (await ok(gql(MARK, { id: newest }))).markNotificationRead as { readAt: string | null };
      expect(marked.readAt).not.toBeNull();
      expect(((await ok(gql(NOTIFICATIONS))) as Bell).unreadNotificationCount).toBe(2);
      expect((await ok(gql(`mutation { markAllNotificationsRead }`))).markAllNotificationsRead).toBe(2);
      expect(((await ok(gql(NOTIFICATIONS))) as Bell).unreadNotificationCount).toBe(0);
    });

    it("shows what your runner is doing, and calls it offline when it hasn't checked in for a while", async () => {
      const STATUS = `query { agentStatus { state step pausedUntil task { id title } } }`;
      const REPORT = `mutation ($input: RunnerStatusInput!) { runnerReportStatus(input: $input) }`;
      expect((await ok(gql(STATUS))).agentStatus).toEqual({ state: 'never', step: null, pausedUntil: null, task: null });

      const { task } = await aiTask();
      await ok(asRunner(REPORT, { input: { state: 'working', taskId: task.id, step: 'build' } }));
      expect((await ok(gql(STATUS))).agentStatus).toEqual({
        state: 'working', step: 'build', pausedUntil: null, task: { id: task.id, title: 'Add a search box' },
      });

      // The usage limit: one notification, not one per check
      const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await ok(asRunner(REPORT, { input: { state: 'paused', pausedUntil: until } }));
      await ok(asRunner(REPORT, { input: { state: 'paused', pausedUntil: until } }));
      expect(((await ok(gql(NOTIFICATIONS))) as Bell).notifications.map((n) => [n.kind, n.task])).toEqual([['usage_limit', null]]);
      expect((await ok(gql(STATUS))).agentStatus).toMatchObject({ state: 'paused', pausedUntil: until });

      // Not seen for 10 minutes: offline (normal, it runs on your laptop)
      await tasksRepository.query(`UPDATE agent_status SET last_seen_at = now() - interval '10 minutes'`);
      expect((await ok(gql(STATUS))).agentStatus).toMatchObject({ state: 'offline', task: null });

      const bad = await asRunner(REPORT, { input: { state: 'dancing' } }).expect(200);
      expect(bad.body.errors[0].extensions.originalError.message[0]).toContain('state must be one of');
    });

    it("another user's runner token can't see or touch your tasks", async () => {
      const { task } = await aiTask();
      const otherToken = (await gqlAsOther(`mutation { createRunnerToken }`).expect(200)).body.data.createRunnerToken;

      const job = await asRunner(NEXT_JOB, undefined, otherToken).expect(200);
      const save = await asRunner(SAVE_PROMPT, { taskId: task.id, input: { prompt: 'Sneaky' } }, otherToken).expect(200);

      const run = await asRunner(
        `mutation ($taskId: Int!) { runnerStartRun(taskId: $taskId, input: { step: "refine" }) }`, { taskId: task.id }, otherToken,
      ).expect(200);

      expect(job.body.data.runnerNextJob).toBeNull();
      expect(save.body.errors[0].message).toContain("isn't waiting for this step");
      expect(run.body.errors[0].message).toBe(`Task ${task.id} not found`);
    });
  });
});
