# Installs (or updates) "Task Board Claude Runner" in Windows Task Scheduler. It keeps watch mode running
# in the background (bin/scheduled-watch.sh), so a waiting task is picked up within about 30 seconds:
#   - started when you log in, and again every 15 minutes in case it stopped (never two at once)
#   - hidden (no window pops up): conhost --headless runs it without a console
#   - no time limit: it keeps running until you log out
#   - "only while plugged in" is checked by the runner itself before each step, so pulling the plug never
#     cuts a build off halfway; on battery it just waits
#   - as you, only while you're logged in, with no admin rights and no stored password
# Its output goes to runner/logs/watch.log.
#
# To install or update it: copy the lines below (from param to the end) into a PowerShell window.
# (Running the file itself would need PowerShell's script-signing check switched off, which isn't worth it.)
param(
    [int]$RestartEveryMinutes = 15,
    [string]$Distro = 'Ubuntu',
    [string]$Script = '/home/thierry/task-board/runner/bin/scheduled-watch.sh'
)

$ErrorActionPreference = 'Stop' # stop at the first error, instead of claiming it worked
$taskName = 'Task Board Claude Runner'
$me = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless wsl.exe -d $Distro -e $Script"
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $me),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $RestartEveryMinutes))
)
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
    -Description "Keeps the task board's Claude runner in watch mode: picks up AI tasks within 30 seconds, on mains power only." `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
"Installed '$taskName' (watch mode, restarted every $RestartEveryMinutes minutes if it stopped), state: $($task.State)."
