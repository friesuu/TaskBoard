#!/bin/sh
# The watchlist's tests, for the Claude runner. Run from the top of a copy of the project, after build.sh.
# The backend's own tests need no database (the sandbox allows no network at all). The frontend has no
# tests yet, so it's linted only.
set -e
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
echo "== backend: tests"
# The same settings as build.sh, so the crates it built are used again
(cd backend && CARGO_PROFILE_DEV_DEBUG=0 cargo test --frozen --jobs 4)
echo "== frontend: lint"
(cd frontend && pnpm exec eslint .)
