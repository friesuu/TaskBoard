#!/usr/bin/env bash
# Measures the NestJS backend: a production build, started on its own on port 3100, against the TEST
# database (never your tasks). Writes the report to bench/results/nest-<date>.md. Linux/WSL only.
#
#   bash bench/nest.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PORT=3100
OUT="$ROOT/bench/results/nest-$(date +%F).md"
LOG="${TMPDIR:-/tmp}/taskboard-bench-nest.log"

cd backend
echo "Building NestJS..."
pnpm run build > /dev/null

# Like the real server (NODE_ENV=production: no SQL logging, no GraphiQL), but on the test database,
# with rate limits off (the benchmark logs in many times) and no way to reach the real Claude
export NODE_ENV=production PORT DB_NAME=taskboard_test DISABLE_RATE_LIMIT=true
export ANTHROPIC_API_KEY=not-used ANTHROPIC_BASE_URL=http://127.0.0.1:9
UPLOAD_DIR=$(mktemp -d)
export UPLOAD_DIR

started=$(date +%s%N)
node dist/main > "$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -rf "$UPLOAD_DIR"' EXIT

# Start-up time: until it answers a request (at most 30 seconds)
until curl -sf -o /dev/null -H 'content-type: application/json' -d '{"query":"{ __typename }"}' "http://127.0.0.1:$PORT/graphql"; do
  if ! kill -0 "$PID" 2>/dev/null || [ $(( ($(date +%s%N) - started) / 1000000 )) -gt 30000 ]; then
    echo "NestJS didn't start. The end of its log ($LOG):"
    tail -20 "$LOG"
    exit 1
  fi
  sleep 0.05
done
startup_ms=$(( ($(date +%s%N) - started) / 1000000 ))

echo "Measuring (about a minute)..."
mkdir -p "$ROOT/bench/results"
report=$(BENCH_URL="http://127.0.0.1:$PORT" BENCH_PID=$PID BENCH_STARTUP_MS=$startup_ms node "$ROOT/bench/bench.mjs")

{
  echo "# NestJS backend, $(date +%F)"
  echo
  echo "- Commit: $(git rev-parse --short HEAD), Node $(node --version), NestJS production build (\`node dist/main\`)"
  echo "- Machine: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs), $(nproc) threads, $(free -g | awk '/Mem:/ {print $2}') GB RAM, $(uname -r)"
  echo "- Database: PostgreSQL $(node -e "process.loadEnvFile('.env'); const { Client } = require('pg'); const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: 'taskboard_test' }); c.connect().then(() => c.query('SHOW server_version')).then((r) => { console.log(r.rows[0].server_version); return c.end(); })") at DB_HOST from backend/.env"
  echo "- The benchmark runs on the same machine as the backend, so they share the CPU"
  echo
  echo "$report"
} > "$OUT"
cat "$OUT"
echo
echo "Saved to ${OUT#"$ROOT"/}"
