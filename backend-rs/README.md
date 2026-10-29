# The backend in Rust

This takes over from the NestJS backend in `../backend`, one part at a time, without changing the API:
the frontend and the Claude runner don't notice.

For now Rust is the **front door**. The app and the runner talk to it on port 3000. It answers the
GraphQL operations that have moved to Rust (the `MOVED` list in `src/routing.rs`) and passes every other
request on to NestJS on port 3001, unchanged. Both read `../backend/.env`, so they use the same database
and the same login secret: a login made by one works in the other.

| Phase | Moved to Rust |
| --- | --- |
| 1 | `me` |
| 2 | `register`, `login`, `logout`, `setTimeZone`, `changePassword`, `setDisplayName`, `deleteAccount` |
| 3 | `boards`, `createBoard`, `renameBoard`, `setBoardProject`, `deleteBoard`; `labels`, `createLabel`, `updateLabel`, `deleteLabel` |
| 4 | `createTask`, `updateTask`, `moveTask`, `deleteTask`, `setTaskLabels`; `tasks`, `taskStats` (once your part is done) |

## Run it (development)

```bash
# 1. NestJS, moved to port 3001
cd ../backend && PORT=3001 pnpm run start:dev

# 2. Rust on port 3000, in another terminal (from this folder)
cargo run
```

The frontend doesn't change: it still talks to port 3000.

## Test it

```bash
cargo test        # Rust's own tests (no database needed)
cargo clippy      # Rust's linter: common mistakes, and clearer ways to write things
cargo fmt         # formats the code (rustfmt.toml: lines up to 120 characters)
scripts/e2e.sh    # the backend's e2e tests, through Rust: 143 passed
```

`scripts/e2e.sh` starts two pairs of servers, each Rust in front of NestJS, all with the tests' settings
(`../backend/test/e2e.env`): the test database, and the tests' fake Claude instead of the real one, so it
costs nothing. The first pair (Rust 3102, NestJS 3101) has the rate limits off, for most tests; the second
(Rust 3103, NestJS 3104) has them on, for the rate limit tests.

An operation counts as moved only when `scripts/e2e.sh` passes with it in `MOVED`.

## Phase 4: your part

Tasks move in phase 4. Creating, changing, moving and deleting tasks, and giving them labels, are done and
already answered by Rust. The two queries that need "today" where the user is, `tasks` (its due date filter)
and `taskStats` (overdue, due this week, finished this week), wait for your part: two function bodies in
`src/dates.rs`, between the `YOUR PART` lines. Until you're done, they keep going to NestJS.

1. **`today_in`:** today's date in the user's time zone, with a `match` over the two kinds of `Zone`.
2. **`week_of`:** the Monday and Sunday around a date. It needs a trait brought into scope (the hints say which).
3. Check with `cargo test dates`: its 4 tests fail until both are right. One of them is about summer time in
   New York, which `today_in` gets right without doing anything special: the zone knows its own summer time.
4. Remove the three `#[allow(...)]` lines in `src/dates.rs`.
5. Move the operations to Rust, in `src/routing.rs`: add `"tasks"` and `"taskStats"` to `queries`.
6. Check: `cargo fmt`, `cargo clippy` (no warnings), `cargo test` (37 passed), then `scripts/e2e.sh` (143 passed).

The compiler's messages are the best help: `cargo build` after each change, and read the first error.

Your parts before this one, all done: phase 1 `me` (`src/users.rs`), phase 2 the login cookie (`src/cookies.rs`),
phase 3 the label colours, `change` and `find_all` (`src/labels.rs`).

## Where Rust doesn't match NestJS yet

The answers were compared with NestJS's for the same requests: 49 in phase 2 (every error case, the rate
limits, the cookies), 48 identical; 71 in phase 3 (every error case of boards and labels, the input rules, and
broken requests), 66 identical; 164 in phase 4 (every task operation and its errors, 31 due dates, the filters,
the numbers in 8 time zones), 158 identical. The ones that aren't:

- **A broken request** (an unknown field, or a variable that doesn't fit its type): both answer HTTP 400 with
  the same code (`BAD_USER_INPUT` for a variable, `GRAPHQL_VALIDATION_FAILED` for the query itself), but the
  message is worded differently (`src/bad_requests.rs`), and for a wrong value written into the query itself,
  Rust points at the argument's name where NestJS points at the value. Missing and null variables match
  exactly. Only a broken client gets any of this, never the app. To look at again when NestJS is gone.
- **`createTask` with `status: null`**: the database refuses it in both. NestJS passes the database's own message
  on ("null value in column ..."); Rust says "Internal server error", as for any database problem, with the
  same code. The app never sends it.
- **A due date before the year 1000**: Rust always refuses it. NestJS's validator.js reads such a date in the
  server's own time zone, so its answer depends on where the server is: in Kuala Lumpur it refuses them too.
- **Two labels saved with the same name at the same moment**: the database refuses the second. NestJS answers
  it with "Internal server error"; Rust with the usual "There is already a label called ..." message.
- **The schema's descriptions**: the `///` comments on Rust's GraphQL types become descriptions in Rust's schema;
  NestJS's has none. Nobody sees them while introspection (`__schema`) still goes to NestJS. To look at again
  then too.

## The files

| File | What it does |
| --- | --- |
| `src/main.rs` | Starts everything: settings, database, routes, CORS |
| `src/config.rs` | The settings, from the environment and `../backend/.env` |
| `src/routing.rs` | Who answers each GraphQL request: Rust or NestJS |
| `src/graphql.rs` | POST /graphql, and the GraphQL schema |
| `src/bad_requests.rs` | Requests that are wrong before anything runs, answered like Apollo (NestJS) answers them |
| `src/proxy.rs` | Passes requests to NestJS and the answers back, with X-Forwarded-For saying who sent them (so NestJS's login limit counts each person) |
| `src/auth.rs` | The login cookie and its token; `register`, `login`, `logout`, `setTimeZone`, `changePassword` |
| `src/account.rs` | `setDisplayName`, `deleteAccount` (with the account's uploaded files) |
| `src/cookies.rs` | The login cookie's `Set-Cookie` header (your part in phase 2) |
| `src/boards.rs` | `boards`, `createBoard`, `renameBoard`, `setBoardProject`, `deleteBoard` |
| `src/labels.rs` | `labels`, `createLabel`, `updateLabel`, `deleteLabel`, `setTaskLabels` (your part in phase 3) |
| `src/tasks.rs` | `tasks` (with its filters), `taskStats`, `createTask`, `updateTask`, `moveTask`, `deleteTask` |
| `src/dates.rs` | Today and this week in the user's time zone (your part in phase 4) |
| `src/iso8601.rs` | validator.js's ISO 8601 date check, for the due date |
| `src/scalars.rs` | The DateTime scalar, written like a JavaScript Date (`2026-10-29T02:34:40.123Z`) |
| `src/passwords.rs` | Password hashes (argon2id, the same as NestJS's) |
| `src/throttle.rs` | Rate limits (5 tries a minute), like NestJS's ThrottlerGuard |
| `src/validate.rs` | Input rules, with NestJS's messages |
| `src/errors.rs` | Errors in the shapes the frontend expects from NestJS |
| `src/users.rs` | The User type, `me`, and the users table's queries |
