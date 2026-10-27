#!/bin/sh
# Claude Code's "apiKeyHelper": Claude Code runs this to get the API key for its own requests to Anthropic.
# This way the key is never put in the environment, so the commands Claude runs (like npm test)
# can't see it. It reads the key from runner/.env, which the sandbox stops those commands reading.
sed -n "s/^ANTHROPIC_API_KEY=//p" "$(dirname "$0")/../.env" | head -n 1
