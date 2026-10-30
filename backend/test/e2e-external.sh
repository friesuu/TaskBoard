#!/bin/sh
# Runs the e2e tests against a backend running as its own program, reached only over HTTP (E2E_URL),
# which is how they'll check the Rust backend. This one starts NestJS from a fresh build on port 3101,
# with the same test settings as `pnpm run test:e2e` (e2e.env), runs the tests, then stops it.
#
#   cd backend && pnpm run test:e2e:external
set -e
cd "$(dirname "$0")/.."

PORT=3101
LOG="${TMPDIR:-/tmp}/taskboard-e2e-backend.log"

# The test settings, for the backend started here (the tests read the same file themselves)
set -a
eval "$(tr -d '\r' < test/e2e.env)"
set +a
UPLOAD_DIR="$(node -p "require('path').join(require('os').tmpdir(), 'taskboard-e2e-uploads')")"
export UPLOAD_DIR PORT

pnpm run build
node dist/main > "$LOG" 2>&1 &
BACKEND=$!
trap 'kill $BACKEND 2>/dev/null' EXIT

# Wait until it answers (at most 30 seconds)
URL="http://127.0.0.1:$PORT"
tries=0
until node -e "fetch('$URL/graphql', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: '{ __typename }' }) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ] || ! kill -0 "$BACKEND" 2>/dev/null; then
    echo "The backend didn't start. The end of its log ($LOG):"
    tail -20 "$LOG"
    exit 1
  fi
  sleep 0.5
done

E2E_URL="$URL" pnpm run test:e2e
