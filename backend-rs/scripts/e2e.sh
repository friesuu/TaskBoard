#!/usr/bin/env bash
# The backend's e2e tests, through Rust: the tests talk to Rust (port 3102), which answers what has moved
# and passes the rest to NestJS (port 3101). Both servers get the test settings (../backend/test/e2e.env):
# the test database, never your real one, and the tests' fake Claude, never the real one (no cost).
# Their own ports, so your dev servers can keep running (the benchmark uses 3100).
#
#   scripts/e2e.sh                     # every test
#   scripts/e2e.sh -t "login"          # extra arguments go to Jest: here only the tests named "login..."
set -euo pipefail

rust_dir="$(cd "$(dirname "$0")/.." && pwd)"
backend_dir="$rust_dir/../backend"
logs="$rust_dir/target/e2e-logs"
mkdir -p "$logs"

# node/pnpm (nvm) and cargo, in case this shell hasn't loaded them
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" > /dev/null; fi
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi

# The tests' settings, for both servers (the tests read the same file themselves). They win over
# ../backend/.env, which both still read for the database address and password and JWT_SECRET.
set -a
eval "$(tr -d '\r' < "$backend_dir/test/e2e.env")"
set +a
UPLOAD_DIR="$(node -p "require('path').join(require('os').tmpdir(), 'taskboard-e2e-uploads')")"
export UPLOAD_DIR

echo "Building NestJS and Rust..."
(cd "$backend_dir" && pnpm run build > /dev/null)
(cd "$rust_dir" && cargo build --quiet)

# NestJS from its own folder, where it finds .env (exec: $! is then NestJS itself, not a subshell)
(cd "$backend_dir" && PORT=3101 exec node dist/main) > "$logs/nestjs.log" 2>&1 &
nestjs=$!
(cd "$rust_dir" && RUST_PORT=3102 NESTJS_URL=http://127.0.0.1:3101 exec target/debug/task-board-backend) \
  > "$logs/rust.log" 2>&1 &
rust=$!
trap 'kill $nestjs $rust 2>/dev/null || true' EXIT # both stop when this script ends, however it ends

# Waits until a server answers GraphQL (at most 30 seconds)
wait_for() {
  for _ in $(seq 60); do
    if curl -sf -o /dev/null -H 'content-type: application/json' -d '{"query":"{ __typename }"}' \
      "http://127.0.0.1:$1/graphql"; then
      return 0
    fi
    sleep 0.5
  done
  echo "Nothing answered on port $1. The logs are in $logs"
  exit 1
}
wait_for 3101
wait_for 3102

echo "Running the e2e tests through Rust..."
cd "$backend_dir"
E2E_URL=http://127.0.0.1:3102 pnpm run test:e2e "$@"
