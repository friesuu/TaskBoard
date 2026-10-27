#!/bin/bash
# Started by Windows Task Scheduler every 15 minutes (see schedule/install-windows-task.ps1).
# Runs one step of the runner, and adds its output, with the time, to logs/scheduler.log.
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
{
    echo "--- $(date "+%Y-%m-%d %H:%M:%S")"
    node --env-file=.env src/main.js once
} >> logs/scheduler.log 2>&1
