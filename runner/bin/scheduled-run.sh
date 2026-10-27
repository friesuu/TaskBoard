#!/bin/bash
# One step of the runner, with its output and the time added to logs/scheduler.log. Windows Task Scheduler
# used to start this every 15 minutes; it now keeps watch mode running instead (bin/scheduled-watch.sh).
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
{
    echo "--- $(date "+%Y-%m-%d %H:%M:%S")"
    node --env-file=.env src/main.js once
} >> logs/scheduler.log 2>&1
