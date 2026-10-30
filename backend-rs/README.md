# The backend in Rust

This took over from the NestJS backend in `../backend`, one part at a time, without changing the API: the
frontend and the Claude runner didn't notice. Since phase 9 it is **the backend**: NestJS is off
(`NESTJS_IS_OFF` in `src/routing.rs`), and the app and the runner talk only to Rust, on port 3000.

It still reads `../backend/.env`, the settings file NestJS used (the database, the login secret, the Claude API
key), so nothing had to move.

While the port was going on, Rust was the **front door**: it answered the GraphQL operations that had moved (the
`MOVED` list in `src/routing.rs`) and passed everything else on to NestJS, unchanged. That way back is still in the
code: with `NESTJS_IS_OFF = false` and NestJS running on port 3001, it works as it did.

| Phase | Moved to Rust |
| --- | --- |
| 1 | `me` |
| 2 | `register`, `login`, `logout`, `setTimeZone`, `changePassword`, `setDisplayName`, `deleteAccount` |
| 3 | `boards`, `createBoard`, `renameBoard`, `setBoardProject`, `deleteBoard`; `labels`, `createLabel`, `updateLabel`, `deleteLabel` |
| 4 | `createTask`, `updateTask`, `moveTask`, `deleteTask`, `setTaskLabels`, `tasks`, `taskStats` |
| 5 | `comments`, `addComment`, `updateComment`, `deleteComment`; `notifications`, `unreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`; `checklistItems`, `addChecklistItem`, `updateChecklistItem`, `moveChecklistItem`, `deleteChecklistItem` |
| 6 | The file upload (`POST /api/tasks/{taskId}/attachments`), `attachments`, `deleteAttachment`, the hourly clean-up of files nobody points at; the download (`GET /api/attachments/{id}/download`) |
| 7 | The Claude runner. Its token: `runnerToken`, `createRunnerToken`, `revokeRunnerToken`. Your review: `updateRefinedPrompt`, `approvePrompt`, `requestPromptChanges`, `requestAiMerge`, `retryAiTask`, `aiNotes`. Its activity: `agentRuns`, `aiRuns`, `agentRunLog`, `agentStatus`. The runner's own: `runnerPing`, `runnerNextJob`, `runnerSavePrompt`, `runnerStartBuild`, `runnerFinishBuild`, `runnerFinishMerge`, `runnerReportError`, `runnerStartRun`, `runnerAppendLog`, `runnerFinishRun`, `runnerReportStatus` |
| 8 | The chat assistant: `chatMessages`, `sendChatMessage`, `clearChat` (the calls to the Claude API, the tool loop and the assistant's 11 tools, retries, 10 messages a minute) |

| 9 | The switch-over: everything NestJS still did. Its migrations (`src/migrations.rs`), how Apollo Server takes a request to `/graphql` (`src/apollo.rs`: CSRF protection, GET, GraphiQL, introspection, every refusal), and Express around it (`src/express.rs`: the 404, addresses in any capitals, its headers). NestJS is off |

## Run it (development)

```bash
cargo run    # from this folder: the backend, on port 3000
```

The settings come from `../backend/.env` (copy `../backend/.env.example` to make one): the database, `JWT_SECRET`,
and `ANTHROPIC_API_KEY` for the chat assistant. When it starts, it brings the database's tables up to date
(NestJS's migrations, `migrations/`), as NestJS did. The frontend talks to port 3000, as it always has.

For the real server: `cargo build --release`, then run `target/release/task-board-backend` with `NODE_ENV=production`
(the login cookie only over https, no introspection and no GraphiQL, as NestJS did), and `FRONTEND_URL` set to the
site's address.

## Test it

```bash
cargo test        # Rust's own tests (no database needed)
cargo clippy      # Rust's linter: common mistakes, and clearer ways to write things
cargo fmt         # formats the code (rustfmt.toml: lines up to 120 characters)
scripts/e2e.sh    # the backend's e2e tests, through Rust: 143 passed
```

`scripts/e2e.sh` starts two copies of the backend, both with the tests' settings (`../backend/test/e2e.env`): the
test database, and the tests' fake Claude instead of the real one, so it costs nothing. The first (port 3102) has
the rate limits off, for most tests; the second (3103) has them on, for the rate limit tests. (With
`NESTJS_IS_OFF = false`, it starts a NestJS behind each, on 3101 and 3104.)

## Phase 9: done

Phase 9 was the switch-over: Rust took over the last things NestJS did, and NestJS was turned off. Its migrations
(`src/migrations.rs`), how Apollo Server takes a request to `/graphql` (`src/apollo.rs`), and what Express did around
the routes (`src/express.rs`).

Your part was two functions; at your request they were written for you. Both are short and worth a read:
- **`not_found`** in `src/express.rs`: the answer to an address nothing answers, exactly as Express gave it,
  `{"message":"Cannot GET /nope","error":"Not Found","statusCode":404}`, with HTTP 404
- **`csrf_safe`** in `src/apollo.rs`: Apollo's protection against cross-site request forgery. Any website can make
  your browser send a "simple" request (a form, a link) to the board, and the browser adds your login cookie; Apollo
  refuses those unless they carry a header no form can add. Its test has the cases NestJS answered.

Checked with NestJS stopped: `scripts/e2e.sh` 143 passed (it starts no NestJS), and
`target/phase9/run.sh rust-dev` then `node target/phase9/diff.mjs target/phase9/nestjs-dev.json
target/phase9/rust-dev.json` 88 of 93 (the differences below; the same in production settings, `rust-prod`). The
answers recorded in phases 2 to 8 are the same as before, with nothing behind Rust.

What else phase 9 found:
- **The app's named operations went to NestJS until now.** The app sends `query AgentRuns(...) {...}` without an
  `operationName`; a document with one operation runs it, named or not, but `routing.rs` sent those on to NestJS. So
  NestJS answered most of the app's own requests (the tests and captures used unnamed ones, which Rust answered).
  Fixed: Rust answers them, and e2e passes with them.
- **The database's tables**: Rust runs NestJS's 13 migrations itself now (the exact SQL TypeORM ran, in
  `migrations/`), and writes them down in TypeORM's own table, so a database NestJS set up carries on as it is. A
  new database set up by Rust was checked against one NestJS set up: the same columns, constraints, indexes and enums.
- **The schema** Rust shows (introspection, GraphiQL) is NestJS's, type for type and field for field (compared through
  graphql-js), apart from the descriptions below.

## Phase 8: done

The chat assistant moved in phase 8, all of it: the calls to the Claude API (`src/chat/claude.rs`, with the same
retries as NestJS's SDK), the tool loop, and the 11 tools Claude can use on the board (`src/chat/tools/`).

Your part was `describe_labels` and `describe_tasks` in `src/chat/context.rs`: they write the board out as text for
Claude, in front of your message between `<my_tasks>` tags (the comment at the top of the file shows what it looks
like). At your request they were written for you. They're worth a read for Rust's string building: `format!`,
`push_str`, `.iter().filter(...)`, `.join(...)`, `Option::as_deref`, and `{{` for a real `{` in `format!`. Their
tests (`cargo test chat::context`) compare the text with NestJS's, character for character.

Your parts in the other phases: phase 1 `me` (`src/users.rs`), phase 2 the login cookie (`src/cookies.rs`), phase 3
the label colours, `change` and `find_all` (`src/labels/`), phase 4 today and this week (`src/dates.rs`), phase 5
`reorder` and the checklist's resolver (`src/checklist/`), phase 6 `content_disposition`
(`src/attachments/routes.rs`). Phase 7's review questions are below, whenever you want them.

## Phase 7: your part (a review)

The Claude runner moves in phase 7, all of it, and it's already answered by Rust. Your part is reading it, not
writing it: most of it is plumbing you've seen before, but the **state handling** is new and easy to get wrong.
The runner on your laptop and you in the browser change the same task at the same time, and the board must never
build a prompt you didn't approve, build a task twice, or lose your feedback.

Start with `src/runner/mod.rs` (the workflow, and which file does what), then answer these. Each one points at
the code; there's no code to write, but `cargo test runner` and `target/phase7/run-extra.sh alone` are there to
try things.

1. **One task's trip.** Follow a task from To do to Done (the diagram in `mod.rs`). For each step: which function
   does it (`jobs.rs` or `review.rs`), which columns of `tasks` it changes, and which condition in `waiting()`
   (`jobs.rs`) makes the runner see the task for the next step.
2. **Check and change in one statement.** `claim()` in `jobs.rs` puts the check ("is this task waiting for this
   step?") into the UPDATE's `WHERE`. NestJS reads the task, checks it in JavaScript, then writes. Four
   `runnerStartBuild` calls for the same task at the same moment: in one try NestJS let 2 through (two builds of
   one task), Rust 1 (`target/phase7/extra.mjs`). Explain why the second one fails in Rust: what does the first
   one's `ai_branch = $3` do to `(ai_branch IS NULL OR ai_built_at IS NOT NULL)`?
3. **`finish_build` doesn't use `claim()`.** What does it check instead, and in which order? Why does a second
   `runnerFinishBuild` get "Task 7 isn't being built", and why can't it send a second "Ready for review"?
4. **Approving exactly what was checked.** `approve` in `review.rs` saves `approved_prompt = $2` with
   `refined_prompt = $2` in the `WHERE`. What could get built without that, if you edited the prompt in another
   tab between the checks and the UPDATE?
5. **Both or neither.** `request_changes` saves your feedback and sets `changes_requested` in one transaction.
   When the UPDATE is refused, `changed(...)?` returns early. Why does that undo the feedback comment, with no
   `rollback()` anywhere?
6. **A lock instead.** `activity.rs` uses another tool: `lock_running_run` locks the run's row (`FOR UPDATE`).
   Why can't `append_log` be one UPDATE like the others (what are its steps)? What would two appends at once do
   to the 5000-line cap without the lock? When is the lock let go after `return Ok(false)`?
7. **One that isn't protected.** `report_status` reads the old state, then writes the new one, with nothing
   between them. Is that a problem? Who sends it, and how often? What's the worst two at once could do?
8. **Two keys, two doors.** Which header does `runner_user` (`tokens.rs`) read, and which one does
   `current_user` (`src/auth/session.rs`)? Find the capture steps that prove the runner's token can't list your
   boards, and your cookie can't ask for the runner's next job.
9. **Hiding secrets.** `redact.rs` writes `(?-u:\b)` where NestJS writes `\b`, and `[A-Za-z]` where NestJS uses
   `/i`. What would go differently with the regex crate's own `\b` and `(?i)`? (Its comments and tests say.)

Tell me your answers (or what you couldn't work out), and I'll go through them with you. If you find something
you'd change, say so: that's the point of a review.

## Where Rust doesn't match NestJS

The answers were compared with NestJS's for the same requests: 49 in phase 2 (every error case, the rate
limits, the cookies), 48 identical; 71 in phase 3 (every error case of boards and labels, the input rules, and
broken requests), 66 identical; 164 in phase 4 (every task operation and its errors, 31 due dates, the filters,
the numbers in 8 time zones), 158 identical; 86 in phase 5 (every checklist, comment and notification operation
and its errors, Claude's comments and prompt feedback), 84 identical; 142 in phase 6 (uploads with every kind of
file, name and broken form, downloads byte for byte, listing and deleting), 140 identical; 118 in phase 7 (the
runner's token, every step of its workflow and every refusal, its run logs with secrets in them, its status, your
review), 118 identical; 78 in phase 8 (every chat operation and refusal, everything Claude is sent, each of the
assistant's tools with good and broken input, the tool loop's limits, and Claude failing in 8 different ways),
76 identical; 93 in phase 9 (every kind of request that isn't an operation: broken, unusual, GET, CSRF, other
methods and addresses, CORS), in development and in production settings, 88 identical in each. Phase 6's error
bodies are byte for byte NestJS's, down to the order of their keys. The ones that aren't:

- **A broken request** (a query that isn't GraphQL, an unknown field, or a variable that doesn't fit its type):
  both answer HTTP 400 with the same code (`GRAPHQL_PARSE_FAILED`, `GRAPHQL_VALIDATION_FAILED`, `BAD_USER_INPUT`)
  and place, but the message is async-graphql's where NestJS gives graphql-js's (`Unknown field "nope"` for `Cannot
  query field "nope"`), and for a wrong value written into the query itself, Rust points at the argument's name
  where NestJS points at the value. Missing and null variables match exactly, and so do all of Apollo's own
  refusals. On the real server, a query with introspection and another mistake: NestJS lists both, Rust only the
  introspection. A body that isn't JSON: the same 400, and NestJS's message when it doesn't start with `{` or `[`
  (`Unexpected token 'n', "nope" is not valid JSON`); otherwise worded differently. Only a broken client gets any
  of this, never the app.
- **Things Rust doesn't do once NestJS is off, which the app never uses**: Apollo's persisted queries, a form body
  with `name[key]` fields (Express reads them as objects), and the `application/graphql-response+json` answers
  Apollo gives a client that asks for them (Rust answers plain JSON). In development, NestJS's errors carry a
  `stacktrace`; Rust's never do. Express's `X-Powered-By: Express` header is gone. GraphiQL is async-graphql's.
- **`createTask` with `status: null`**: the database refuses it in both. NestJS passes the database's own message
  on ("null value in column ..."); Rust says "Internal server error", as for any database problem, with the
  same code. The app never sends it.
- **An upload whose name is cut in the middle of an emoji** (names over 200 characters are shortened, counted
  the way JavaScript counts): NestJS's answer to the upload holds half of the emoji (`\ud83d`); Rust strings can't,
  so Rust's has "�" there. The database saves "�" in both, so only that one answer differs.
- **A stored file that has gone from the disk** (its row is still there): both answer the download with HTTP 400
  and Node's error, `ENOENT: no such file or directory, open '<the file's path>'`, while NestJS runs. That shows the
  server's folder, so once NestJS is off, Rust leaves the path out: `ENOENT: no such file or directory`.
- **A form's `filename*` in a character set other than UTF-8 or Latin-1**: NestJS's busboy reads more of them;
  Rust skips that part of the form. Browsers never send `filename*`.
- **A notification's task, and a run's task** (`aiRuns`, `agentRuns`): NestJS loads only a notification's or an
  `aiRuns` run's task `id`, `title` and `boardId` (what the bell and the AI Activity page show), so asking for any
  other field of it gives an error; `agentRuns` doesn't load the task at all. Rust gives the whole task.
- **Several top-level fields failing at once** (e.g. the bell's `notifications` and `unreadNotificationCount`
  when logged out): NestJS's GraphQL library reports only the first error (it waits on the fields with
  `Promise.all`, which stops at the first failure); Rust reports one for each field. The app reads the first. Both
  answer `data: null`, as GraphQL's rules say.
- **A due date before the year 1000**: Rust always refuses it. NestJS's validator.js reads such a date in the
  server's own time zone, so its answer depends on where the server is: in Kuala Lumpur it refuses them too.
- **Two runner steps on the same task at the same moment** (e.g. two runners with the same token): NestJS
  checks the task, then changes it, so both can go through: 2 of 4 `runnerStartBuild` at once did. Rust checks
  and changes it in one statement: only the first goes through, the others get "isn't waiting for this step".
  The same for your review (`approvePrompt` and the others) against a change made at the same moment.
- **A DateTime the runner sends that isn't a full date and time with its time zone** (a log line's `at`, a
  pause's `pausedUntil`): NestJS reads anything JavaScript's `new Date()` reads: "2026-10-29" (midnight UTC),
  "2026-10-29T10:00:00" (in the server's own time zone), a number of milliseconds; and refuses the rest with
  `lines.0.at must be a Date instance`. Rust refuses all of them as a broken request (HTTP 400, `BAD_USER_INPUT`).
  The runner always sends full ones (`toISOString()`).
- **A run's cost that's a whole number**: NestJS sends `"costUsd":3`, Rust `"costUsd":3.0` (JavaScript has one
  kind of number; Rust's float always shows its point). Both are the same number once read.
- **Several of the assistant's tools in one answer** (e.g. Claude creates two tasks at once): NestJS runs them all
  at the same moment, so the two tasks can end up with the same position, in either order (the phase 8 capture
  caught NestJS doing both). Rust runs them one after another, in Claude's order.
- **One of the assistant's tools running into a database error** (e.g. Claude gives `create_task` the date
  2026-13-45, which the tool's own rule, YYYY-MM-DD, lets through): NestJS tells Claude the database's message
  (`date/time field value out of range: "2026-13-45"`), Rust "Internal server error", as for any database problem.
  Only Claude reads it; you see what Claude makes of it.
- **A prompt or build summary cut in the middle of an emoji** (the assistant's `get_ai_details` cuts texts over 4000
  UTF-16 units): NestJS sends Claude half of the emoji, Rust "�".
- **Two labels saved with the same name at the same moment**: the database refuses the second. NestJS answers
  it with "Internal server error"; Rust with the usual "There is already a label called ..." message.
- **The schema's descriptions**: the `///` comments on Rust's GraphQL types become descriptions in Rust's schema;
  NestJS's has none. Once NestJS is off they show in GraphiQL (in development; the real server answers no
  introspection, as NestJS didn't). They were kept: they explain the API to whoever reads it there.

## How a module is laid out

Each feature is split the way NestJS splits it, so the same parts are in the same places:

| Part | In NestJS | What it does |
| --- | --- | --- |
| `types.rs` | `*.entity.ts`, enums, `@ObjectType`s | What the API shows (and what a database row fills) |
| `inputs.rs` | the DTOs | What the operations take. Each input's `checked` does what NestJS's ValidationPipe does: trims it, checks its rules, and gives it back. |
| `resolver.rs` | `*.resolver.ts` | The GraphQL operations: the login check, then `checked`, then the service. Nothing else. |
| `service.rs` | `*.service.ts` | The work itself: plain functions that take the database and whose data it is, with no GraphQL in them, so other modules (the chat assistant's tools) can use them too |
| `mod.rs` | `*.module.ts` | The module's front door: its files, and what the rest of the backend may use (`pub use`) |

The bigger modules are folders (`src/tasks/`, `src/labels/`, `src/auth/`). The small ones (`boards.rs`,
`account.rs`) are one file each, with the same parts as sections, in the same order.

## The files

| File | What it does |
| --- | --- |
| `src/main.rs` | Starts everything: settings, database, routes, CORS |
| `src/config.rs` | The settings, from the environment and `../backend/.env` |
| `src/routing.rs` | Who answers each GraphQL request: Rust or NestJS; `NESTJS_IS_OFF`, the switch-over |
| `src/graphql.rs` | /graphql, and the GraphQL schema |
| `src/apollo.rs` | How Apollo Server (NestJS's GraphQL server) takes a request: the body, CSRF (phase 9's part, written for you), GET, GraphiQL, its refusals |
| `src/express.rs` | What Express did around the routes: addresses in any capitals, its headers, the 404 (phase 9's part, written for you) |
| `src/migrations.rs`, `migrations/` | The database's tables: NestJS's migrations, run when Rust starts |
| `src/bad_requests.rs` | Requests that are wrong before anything runs, answered like Apollo (NestJS) answers them |
| `src/proxy.rs` | Passed requests to NestJS and the answers back while the port went on, with X-Forwarded-For saying who sent them (only used again with `NESTJS_IS_OFF = false`) |
| `src/auth/` | `register`, `login`, `logout`, `setTimeZone`, `changePassword`; `session.rs`: the login cookie and its token, and `current_user` |
| `src/account.rs` | `setDisplayName`, `deleteAccount` (with the account's uploaded files) |
| `src/attachments/` | The file upload and download (`routes.rs`; your part in phase 6: `content_disposition`), `attachments`, `deleteAttachment`, and the clean-up of files nobody points at |
| `src/cookies.rs` | The login cookie's `Set-Cookie` header (your part in phase 2) |
| `src/boards.rs` | `boards`, `createBoard`, `renameBoard`, `setBoardProject`, `deleteBoard` |
| `src/labels/` | `labels`, `createLabel`, `updateLabel`, `deleteLabel`, `setTaskLabels` (your part in phase 3: `LabelColor` in `types.rs`, `change` and `find_all` in `service.rs`) |
| `src/tasks/` | `tasks` (with its filters), `taskStats`, `createTask`, `updateTask`, `moveTask`, `deleteTask` |
| `src/checklist/` | `checklistItems`, `addChecklistItem`, `updateChecklistItem`, `moveChecklistItem`, `deleteChecklistItem` (your part in phase 5) |
| `src/comments/` | `comments`, `addComment`, `updateComment`, `deleteComment` |
| `src/notifications.rs` | The bell: `notifications`, `unreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`; `notify`, for the runner's side |
| `src/chat/` | The chat assistant: `chatMessages`, `sendChatMessage`, `clearChat`; the Claude API and the tool loop (`claude.rs`), the assistant's tools (`tools/`), the board written out for Claude (`context.rs`, phase 8's part, written for you) |
| `src/runner/` | The Claude runner: its token and login check (`tokens.rs`), its jobs and steps (`jobs.rs`), your review (`review.rs`), its runs, logs and status (`activity.rs`), hiding secrets (`redact.rs`); your part in phase 7 is a review of it |
| `src/dates.rs` | Today and this week in the user's time zone (your part in phase 4) |
| `src/iso8601.rs` | validator.js's ISO 8601 date check, for the due date |
| `src/scalars.rs` | The DateTime scalar, written like a JavaScript Date (`2026-10-29T02:34:40.123Z`), and read from the runner |
| `src/passwords.rs` | Password hashes (argon2id, the same as NestJS's) |
| `src/throttle.rs` | Rate limits (5 tries a minute), like NestJS's ThrottlerGuard: `limit_by_address`, `limit_by_account` |
| `src/validate.rs` | Input rules, with NestJS's messages |
| `src/errors.rs` | Errors in the shapes the frontend expects from NestJS |
| `src/users.rs` | The User type, `me`, and the users table's queries |
