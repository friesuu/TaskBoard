# The backend in Rust

This takes over from the NestJS backend in `../backend`, one part at a time, without changing the API:
the frontend and the Claude runner don't notice.

For now Rust is the **front door**. The app and the runner talk to it on port 3000. It answers the
GraphQL operations that have moved to Rust (the `MOVED` list in `src/routing.rs`) and passes every other
request on to NestJS on port 3001, unchanged. Both read `../backend/.env`, so they use the same database
and the same login secret: a login made by NestJS works in Rust.

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
scripts/e2e.sh    # the backend's e2e tests, through Rust (Rust on 3102, NestJS on 3101)
```

`scripts/e2e.sh` gives both servers the tests' settings (`../backend/test/e2e.env`): the test database,
and the tests' fake Claude instead of the real one, so it costs nothing. The two rate limit tests are
skipped through Rust; they run with `pnpm run test:e2e` in `../backend`.

An operation counts as moved only when `scripts/e2e.sh` passes with it in `MOVED`.

## Phase 1: your part

`me` (the logged-in user) is the first operation to move. Everything around it is written; two function
bodies in `src/users.rs` are yours (`todo!()` for now). Until you're done, `me` keeps going to NestJS, so
everything works in the meantime.

1. Write `find`: one user by id, with SQL (the hints are above it).
2. Write `me`: the logged-in user (the hint is above it).
3. Remove the three `#[allow(...)]` lines: two in `src/users.rs`, one above `current_user` in
   `src/auth.rs`. They only hide "never used" warnings while the bodies are `todo!()`.
4. Move `me` to Rust: in `src/routing.rs`, `queries: &[]` becomes `queries: &["me"]`.
5. Check: `cargo clippy` (no warnings), then `scripts/e2e.sh` (140 passed, 2 skipped). Many tests use `me`
   to see who's logged in, so a mistake shows up there.

The compiler's messages are the best help: `cargo build` after each change, and read the first error.

## The files

| File | What it does |
| --- | --- |
| `src/main.rs` | Starts everything: settings, database, routes, CORS |
| `src/config.rs` | The settings, from the environment and `../backend/.env` |
| `src/routing.rs` | Who answers each GraphQL request: Rust or NestJS |
| `src/graphql.rs` | POST /graphql, and the GraphQL schema |
| `src/proxy.rs` | Passes requests to NestJS and the answers back, with X-Forwarded-For saying who sent them (so NestJS's login limit counts each person) |
| `src/auth.rs` | Reads the login cookie and checks it, like NestJS's AuthService.userFromToken |
| `src/errors.rs` | Errors in the shape the frontend expects from NestJS |
| `src/users.rs` | The User type and `me` |
