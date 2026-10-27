// "Only while the laptop is plugged in" (your choice), checked before each step starts, so a step that has
// started is never cut off by pulling the plug. Ubuntu (WSL) can't see the battery, so this asks Windows.
// Only asked when there's a step to start: watch mode doesn't run PowerShell every 30 seconds.
import { run } from './shell.js';

const POWERSHELL = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
// Prints True (plugged in), False (on battery), or nothing (no battery: a desktop is always plugged in)
const QUERY = '(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue '
    + '| Select-Object -First 1).PowerOnline';

export function isOnBattery(output)
{
    return output.trim().toLowerCase() === 'false';
}

// If Windows can't be asked, the step goes ahead: this is a preference, not one of the safety locks
export async function onBattery()
{
    const result = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', QUERY], { timeoutMs: 30 * 1000 });
    return result.code === 0 && isOnBattery(result.stdout);
}
