#!/bin/bash
# Started by Windows Task Scheduler when you log in, and again every 15 minutes in case it stopped
# (see schedule/install-windows-task.ps1). Keeps watch mode running in the background, and adds its output,
# with the time, to logs/watch.log. If watch mode is already running, flock makes this one stop at once.
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs "$HOME/.task-runner"
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
exec flock -n "$HOME/.task-runner/watch.lock" sh -c '
    node --env-file=.env src/main.js watch 2>&1 | while IFS= read -r line; do
        echo "$(date "+%Y-%m-%d %H:%M:%S") $line"
    done >> logs/watch.log'
