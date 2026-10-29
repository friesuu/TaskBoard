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
| 3 | `boards`, `createBoard`, `renameBoard`, `setBoardProject`, `deleteBoard`; `labels`, `createLabel`, `updateLabel`, `deleteLabel` (once your part is done) |

`setTaskLabels` stays in NestJS until phase 4: it answers with a whole Task, and tasks move then.

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

## Phase 3: your part

Boards and labels move in phase 3. The boards are done and already answered by Rust. Three pieces of the
labels are yours, in `src/labels.rs` between the `YOUR PART` lines. Until you're done, the label operations
keep going to NestJS, so everything works in the meantime.

1. **An enum:** add the other seven colours to `LabelColor`. `cargo test labels` checks them, in order.
2. **A `match`:** write the body of `change`, one arm for each of `MaybeUndefined`'s three variants.
   `cargo test labels` has a test for each.
3. **A query:** write the body of `find_all`, the SQL for a board's labels, A to Z. No unit test can reach the
   database; `scripts/e2e.sh` checks it (step 6).
4. Remove the two `#[allow(...)]` lines in `src/labels.rs`.
5. Move the operations to Rust, in `src/routing.rs`: add `"labels"` to `queries`, and `"createLabel"`,
   `"updateLabel"`, `"deleteLabel"` to `mutations`.
6. Check: `cargo fmt`, `cargo clippy` (no warnings), `cargo test` (31 passed), then `scripts/e2e.sh` (143 passed).

The compiler's messages are the best help: `cargo build` after each change, and read the first error.

Phases 1 (`me`, in `src/users.rs`) and 2 (the login cookie, in `src/cookies.rs`) were your parts before this
one: done.

## Where Rust doesn't match NestJS yet

The answers were compared with NestJS's for the same requests: 49 in phase 2 (every error case, the rate
limits, the cookies), 48 identical; 71 in phase 3 (every error case of boards and labels, the input rules, and
broken requests), 66 identical. The ones that aren't:

- **A broken request** (an unknown field, or a variable that doesn't fit its type): both answer HTTP 400 with
  the same code (`BAD_USER_INPUT` for a variable, `GRAPHQL_VALIDATION_FAILED` for the query itself), but the
  message is worded differently (`src/bad_requests.rs`), and for a wrong value written into the query itself,
  Rust points at the argument's name where NestJS points at the value. Missing and null variables match
  exactly. Only a broken client gets any of this, never the app. To look at again when NestJS is gone.
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
| `src/labels.rs` | `labels`, `createLabel`, `updateLabel`, `deleteLabel` (your part in phase 3) |
| `src/scalars.rs` | The DateTime scalar, written like a JavaScript Date (`2026-10-29T02:34:40.123Z`) |
| `src/passwords.rs` | Password hashes (argon2id, the same as NestJS's) |
| `src/throttle.rs` | Rate limits (5 tries a minute), like NestJS's ThrottlerGuard |
| `src/validate.rs` | Input rules, with NestJS's messages |
| `src/errors.rs` | Errors in the shapes the frontend expects from NestJS |
| `src/users.rs` | The User type, `me`, and the users table's queries |
