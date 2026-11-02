#!/bin/sh
# The watchlist's build check, for the Claude runner. Run from the top of a copy of the project.
# It lives outside the copy Claude works in, so Claude can't change the check that judges its work.
set -e
# cargo, in case this shell hasn't loaded it (the runner's PATH doesn't have ~/.cargo/bin)
if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi
echo "== backend: build"
# --frozen: the crate versions in Cargo.lock, without the network (the sandbox has none), so the crates come
# from ~/.cargo, where earlier builds downloaded them. Each task's copy builds from scratch, so: no debug
# info (not needed to see that it builds) and at most 4 compilers at once, so a busy laptop has memory left.
(cd backend && CARGO_PROFILE_DEV_DEBUG=0 cargo build --frozen --jobs 4)
echo "== frontend: build"
(cd frontend && pnpm run build)
