# Running the runner on a schedule (Windows)

Windows Task Scheduler starts the runner inside Ubuntu every 15 minutes, hidden, and only while the laptop
is plugged in. Each run does one step for one task, then stops. The output goes to `runner/logs/scheduler.log`.

The task board itself (its backend) must be running for the runner to do anything. When it isn't, each run
just notes "Can't use the task board" in the log and stops.

Run these in **PowerShell** (Windows, not Ubuntu):

| What | Command |
| --- | --- |
| Install, or update it | Copy the lines of `install-windows-task.ps1` (from `param` to the end) into PowerShell |
| Switch it off | `Disable-ScheduledTask -TaskName "Task Board Claude Runner"` |
| Switch it back on | `Enable-ScheduledTask -TaskName "Task Board Claude Runner"` |
| Run it now | `Start-ScheduledTask -TaskName "Task Board Claude Runner"` |
| See when it last ran | `Get-ScheduledTaskInfo -TaskName "Task Board Claude Runner"` |
| Remove it | `Unregister-ScheduledTask -TaskName "Task Board Claude Runner" -Confirm:$false` |

You can also find it in the Task Scheduler app, under "Task Scheduler Library".
