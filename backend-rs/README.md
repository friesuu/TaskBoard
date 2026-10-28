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
| 2 | `register`, `login`, `logout`, `setTimeZone`, `changePassword`, `setDisplayName`, `deleteAccount` (once your part is done) |

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

## Phase 2: your part

Logging in, registering and the account settings move in phase 2. Everything is written except the login
cookie's `Set-Cookie` header: two function bodies in `src/cookies.rs` are yours (`todo!()` for now). Until
you're done, these operations keep going to NestJS, so everything works in the meantime.

1. Write `login_cookie` and `clear_cookie` (the hints are above them). Check with `cargo test cookies`:
   its 4 tests fail until both are right, and they show exactly which characters differ.
2. Remove the three `#[allow(...)]` lines in `src/cookies.rs`.
3. Move the operations to Rust: in `src/routing.rs`, `mutations: &[]` becomes
   `mutations: &["register", "login", "logout", "setTimeZone", "changePassword", "setDisplayName", "deleteAccount"]`.
4. Check: `cargo fmt`, `cargo clippy` (no warnings), `cargo test` (25 passed), then `scripts/e2e.sh` (143 passed).
   Almost every test logs in first, so a wrong cookie shows up everywhere.

The compiler's messages are the best help: `cargo build` after each change, and read the first error.

Phase 1 (`me`, in `src/users.rs`) was your part before this one: done.

## Where Rust doesn't match NestJS yet

The answers were compared with NestJS's for the same 49 requests (every error case of phase 2, the rate
limits, the cookies): 48 were identical. The one that isn't:

- **A request that isn't valid GraphQL for the schema** (e.g. a required field missing): both answer HTTP 400
  with the code `GRAPHQL_VALIDATION_FAILED`, but the message is worded differently, and Rust also sends
  `"data": null`. Only a broken request gets this, never the app. To look at again when NestJS is gone.
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
| `src/proxy.rs` | Passes requests to NestJS and the answers back, with X-Forwarded-For saying who sent them (so NestJS's login limit counts each person) |
| `src/auth.rs` | The login cookie and its token; `register`, `login`, `logout`, `setTimeZone`, `changePassword` |
| `src/account.rs` | `setDisplayName`, `deleteAccount` (with the account's uploaded files) |
| `src/cookies.rs` | The login cookie's `Set-Cookie` header (your part in phase 2) |
| `src/passwords.rs` | Password hashes (argon2id, the same as NestJS's) |
| `src/throttle.rs` | Rate limits (5 tries a minute), like NestJS's ThrottlerGuard |
| `src/validate.rs` | Input rules, with NestJS's messages |
| `src/errors.rs` | Errors in the shapes the frontend expects from NestJS |
| `src/users.rs` | The User type, `me`, and the users table's queries |
