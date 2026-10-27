#!/bin/sh
# The task board's test check, for the Claude runner. Run from the top of a copy of the project.
# Frontend tests and lint only: the backend's tests need the database, and the sandbox allows no network
# at all (not even to the database on this computer). The backend is still checked by build.sh.
set -e
echo "== frontend: tests"
(cd frontend && pnpm exec vitest run)
echo "== frontend: lint"
(cd frontend && pnpm exec eslint .)
