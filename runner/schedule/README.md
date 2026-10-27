# Running the runner by itself (Windows)

Windows Task Scheduler starts watch mode inside Ubuntu when you log in, hidden, and keeps it running: a
waiting task is picked up within about 30 seconds. If watch mode ever stops, the task starts it again
within 15 minutes (never two at once). Nothing starts while the laptop is on battery: the runner checks
before each step, so pulling the plug never cuts a build off halfway. The output goes to
`runner/logs/watch.log`.

The task board itself (its backend) must be running for the runner to do anything. When it isn't, watch
mode notes "Can't use the task board" in the log and tries again every 30 seconds.

Run these in **PowerShell** (Windows, not Ubuntu):

| What | Command |
| --- | --- |
| Install, or update it | Copy the lines of `install-windows-task.ps1` (from `param` to the end) into PowerShell |
| Switch it off | `Disable-ScheduledTask -TaskName "Task Board Claude Runner"` |
| Switch it back on | `Enable-ScheduledTask -TaskName "Task Board Claude Runner"` |
| Start it now | `Start-ScheduledTask -TaskName "Task Board Claude Runner"` |
| Stop it now (until the next start) | `Stop-ScheduledTask -TaskName "Task Board Claude Runner"` |
| See whether it's running | `(Get-ScheduledTask -TaskName "Task Board Claude Runner").State` |
| Remove it | `Unregister-ScheduledTask -TaskName "Task Board Claude Runner" -Confirm:$false` |

You can also find it in the Task Scheduler app, under "Task Scheduler Library".
