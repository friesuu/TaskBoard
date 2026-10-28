// Measures a running task board backend from outside, over HTTP only, so the same script measures
// NestJS now and the Rust backend later. It prints a Markdown report. See README.md.
//
//   BENCH_URL=http://127.0.0.1:3100 BENCH_PID=12345 BENCH_STARTUP_MS=2100 node bench.mjs
//
// BENCH_PID: the backend's process id, for its memory (read from /proc, so Linux/WSL only)
// BENCH_STARTUP_MS: how long the backend took to start (measured by the script that started it)
import { readFileSync } from 'fs';

const URL = process.env.BENCH_URL ?? 'http://127.0.0.1:3100';
const PID = process.env.BENCH_PID;
const USER = { email: 'bench@test.com', password: 'bench-password' };

const ROUNDS = 300; // requests per operation, one at a time
const WARMUP = 30; // requests per operation before measuring (the first ones are slower)
const LOAD_SECONDS = 5; // how long each concurrency level runs
const BOARD_TASKS = 50; // a full-looking board: tasks, labels and checklists

// Same fields the frontend asks for on every board load (TASK_FIELDS in frontend/src/api.js)
const TASK_FIELDS =
  'id title description status dueDate checklistDone checklistTotal attachmentCount labels { id name color } ' +
  'refinedPrompt changesRequested promptApprovedAt aiBranch aiBuiltAt aiChecksPassed aiError aiMergeRequestedAt aiMergedAt';

let cookie = '';

async function gql(query, variables) {
  const res = await fetch(`${URL}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`${body.errors[0].message} (in: ${query.trim().slice(0, 50)})`);
  return { data: body.data, res };
}

// The backend's memory right now, in MB (what the operating system counts as in use: resident set size)
function memoryMb() {
  if (!PID) return null;
  const kb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${PID}/status`, 'utf8'))[1]);
  return Math.round(kb / 1024);
}

// p50 = half the requests were faster than this, p95 = 95% were, ...
function summary(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((sum, t) => sum + t, 0) / sorted.length;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), mean };
}

// Runs `request` `rounds` times, one after the other, after a warm-up. Returns each one's time in ms.
async function timeEach(request, rounds = ROUNDS, warmup = WARMUP) {
  for (let i = 0; i < warmup; i++) await request(i);
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const started = performance.now();
    await request(i);
    times.push(performance.now() - started);
  }
  return times;
}

// `workers` requests in flight at all times, for LOAD_SECONDS. Returns requests per second and latencies.
async function underLoad(request, workers) {
  const times = [];
  const until = performance.now() + LOAD_SECONDS * 1000;
  let peakMb = memoryMb();
  const sampler = setInterval(() => (peakMb = Math.max(peakMb, memoryMb())), 100);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (performance.now() < until) {
      const started = performance.now();
      await request();
      times.push(performance.now() - started);
    }
  }));
  clearInterval(sampler);
  return { perSecond: times.length / LOAD_SECONDS, ...summary(times), peakMb };
}

async function logIn() {
  const { res } = await gql('mutation ($input: LoginInput!) { login(input: $input) { id } }', { input: USER });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
}

// ---- Setup: the bench user and two boards (one to read, one to write to) ----

try {
  await logIn();
} catch {
  await gql('mutation ($input: RegisterInput!) { register(input: $input) { id } }', { input: USER });
  await logIn();
}
const createBoard = async (name) =>
  (await gql('mutation ($input: BoardNameInput!) { createBoard(input: $input) { id } }', { input: { name } })).data.createBoard.id;
const readBoard = await createBoard('Bench: read');
const writeBoard = await createBoard('Bench: write');

const statuses = ['TODO', 'IN_PROGRESS', 'DONE'];
const colors = ['BLUE', 'GREEN', 'ORANGE', 'PINK', 'PURPLE'];
const labelIds = [];
for (const [i, color] of colors.entries()) {
  const { data } = await gql('mutation ($b: Int!, $input: LabelInput!) { createLabel(boardId: $b, input: $input) { id } }',
    { b: readBoard, input: { name: `Label ${i + 1}`, color } });
  labelIds.push(data.createLabel.id);
}
const readTasks = [];
for (let i = 0; i < BOARD_TASKS; i++) {
  const { data } = await gql('mutation ($input: CreateTaskInput!) { createTask(input: $input) { id } }', {
    input: {
      boardId: readBoard,
      title: `Task ${i + 1}`,
      description: 'Something to do, with a sentence or two of detail so the text is a realistic size.',
      status: statuses[i % statuses.length],
      dueDate: i % 2 ? `2026-12-${String((i % 28) + 1).padStart(2, '0')}` : null,
    },
  });
  const id = data.createTask.id;
  readTasks.push(id);
  await gql('mutation ($t: Int!, $input: SetTaskLabelsInput!) { setTaskLabels(taskId: $t, input: $input) { id } }',
    { t: id, input: { labelIds: [labelIds[i % 5], labelIds[(i + 2) % 5]] } });
  if (i % 5 < 2) {
    for (const text of ['First step', 'Second step', 'Third step']) {
      await gql('mutation ($t: Int!, $input: ChecklistItemInput!) { addChecklistItem(taskId: $t, input: $input) { id } }',
        { t: id, input: { text } });
    }
  }
}
const writeTask = (await gql('mutation ($input: CreateTaskInput!) { createTask(input: $input) { id } }',
  { input: { boardId: writeBoard, title: 'Edited over and over' } })).data.createTask.id;

// ---- Measure ----

const idleMb = memoryMb();
const operations = {};

operations['me (check the login cookie)'] = await timeEach(() => gql('query { me { id } }'));
operations['boards'] = await timeEach(() => gql('query { boards { id name project } }'));
operations[`tasks (a ${BOARD_TASKS}-task board, all fields)`] =
  await timeEach(() => gql(`query ($b: Int!) { tasks(boardId: $b) { ${TASK_FIELDS} } }`, { b: readBoard }));
operations['createTask'] = await timeEach((i) =>
  gql('mutation ($input: CreateTaskInput!) { createTask(input: $input) { id } }', { input: { boardId: writeBoard, title: `New ${i}` } }));
operations['updateTask'] = await timeEach((i) =>
  gql('mutation ($id: Int!, $input: UpdateTaskInput!) { updateTask(id: $id, input: $input) { id } }', { id: writeTask, input: { title: `Edit ${i}` } }));
// Drag and drop: the first To do task to the bottom of the column and back (renumbers the column)
const todo = readTasks.filter((_, i) => i % statuses.length === 0);
operations['moveTask (drag and drop)'] = await timeEach((i) =>
  gql('mutation ($id: Int!, $input: MoveTaskInput!) { moveTask(id: $id, input: $input) { id } }',
    { id: todo[i % 2 ? todo.length - 1 : 0], input: { status: 'TODO', position: i % 2 ? 0 : todo.length - 1 } }));
// Logging in checks the password with argon2, which is slow on purpose: fewer rounds
operations['login (argon2 password check)'] = await timeEach(() => logIn(), 20, 3);

const afterRequestsMb = memoryMb();
const tasksQuery = () => gql(`query ($b: Int!) { tasks(boardId: $b) { ${TASK_FIELDS} } }`, { b: readBoard });
const load = {};
for (const workers of [1, 10, 50]) load[workers] = await underLoad(tasksQuery, workers);
const afterLoadMb = memoryMb();

// Clean up: the two boards and everything on them
await gql('mutation ($id: Int!) { deleteBoard(id: $id) }', { id: readBoard });
await gql('mutation ($id: Int!) { deleteBoard(id: $id) }', { id: writeBoard });

// ---- Report ----

const ms = (t) => (t < 10 ? t.toFixed(2) : t.toFixed(1));
const lines = [];
lines.push('### Start-up and memory', '');
lines.push('| | |', '| --- | --- |');
if (process.env.BENCH_STARTUP_MS) lines.push(`| Start-up (until the first answer) | ${process.env.BENCH_STARTUP_MS} ms |`);
if (PID) {
  lines.push(`| Memory, idle (after setup) | ${idleMb} MB |`);
  lines.push(`| Memory, after ${ROUNDS}-request rounds | ${afterRequestsMb} MB |`);
  lines.push(`| Memory, highest under load | ${Math.max(...Object.values(load).map((l) => l.peakMb))} MB |`);
  lines.push(`| Memory, after load | ${afterLoadMb} MB |`);
}
lines.push('', `### One request at a time (${ROUNDS} each, after ${WARMUP} warm-up; login: 20)`, '');
lines.push('| Operation | p50 | p95 | p99 | mean |', '| --- | ---: | ---: | ---: | ---: |');
for (const [name, times] of Object.entries(operations)) {
  const s = summary(times);
  lines.push(`| ${name} | ${ms(s.p50)} ms | ${ms(s.p95)} ms | ${ms(s.p99)} ms | ${ms(s.mean)} ms |`);
}
lines.push('', `### Many at once: the ${BOARD_TASKS}-task board query, ${LOAD_SECONDS} s per level`, '');
lines.push('| In flight | Requests/s | p50 | p95 | p99 |', '| ---: | ---: | ---: | ---: | ---: |');
for (const [workers, l] of Object.entries(load)) {
  lines.push(`| ${workers} | ${Math.round(l.perSecond)} | ${ms(l.p50)} ms | ${ms(l.p95)} ms | ${ms(l.p99)} ms |`);
}
console.log(lines.join('\n'));
