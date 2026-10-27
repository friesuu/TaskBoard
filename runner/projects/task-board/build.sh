#!/bin/sh
# The task board's build check, for the Claude runner. Run from the top of a copy of the project.
# It lives outside the copy Claude works in, so Claude can't change the check that judges its work.
set -e
echo "== backend: build"
(cd backend && pnpm run build)
echo "== frontend: build"
(cd frontend && pnpm run build)
