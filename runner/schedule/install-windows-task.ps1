# Installs (or updates) "Task Board Claude Runner" in Windows Task Scheduler:
#   - every 15 minutes, starting a minute from now
#   - hidden (no window pops up): conhost --headless runs it without a console
#   - only while the laptop is plugged in, and stopped if it goes onto battery
#   - never two at once (and the runner's own lock file makes sure of that too)
#   - as you, only while you're logged in, with no admin rights and no stored password
# Each run does one step for one task (see bin/scheduled-run.sh); its output goes to runner/logs/scheduler.log.
#
# To install or update it: copy the lines below (from param to the end) into a PowerShell window.
# (Running the file itself would need PowerShell's script-signing check switched off, which isn't worth it.)
param(
    [int]$EveryMinutes = 15,
    [string]$Distro = 'Ubuntu',
    [string]$Script = '/home/thierry/task-board/runner/bin/scheduled-run.sh'
)

$ErrorActionPreference = 'Stop' # stop at the first error, instead of claiming it worked
$taskName = 'Task Board Claude Runner'

$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless wsl.exe -d $Distro -e $Script"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
# Not starting on battery, and stopping when the laptop goes onto battery, are the defaults here
# (the switches that exist are -AllowStartIfOnBatteries and -DontStopIfGoingOnBatteries, which we leave off)
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Runs the task board's Claude runner (one step for one AI task) every $EveryMinutes minutes, on mains power only." `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
"Installed '$taskName': every $EveryMinutes minutes, state: $($task.State)."
