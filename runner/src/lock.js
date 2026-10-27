// One runner at a time: a lock file holding the running runner's process id.
// If a runner crashed and left the file behind, the next one notices that process is gone and carries on.
import { mkdirSync, openSync, readFileSync, unlinkSync, writeSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

const isRunning = (pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; } // signal 0 = "does it exist?"
};

// true = we hold the lock; false = another runner is already working
export function takeLock(lockFile)
{
    mkdirSync(dirname(lockFile), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++)
    {
        try
        {
            const fd = openSync(lockFile, 'wx'); // fails if the file already exists
            writeSync(fd, String(process.pid));
            closeSync(fd);
            return true;
        }
        catch (err)
        {
            if (err.code !== 'EEXIST') throw err;
            const pid = Number(readFileSync(lockFile, 'utf8'));
            if (pid && isRunning(pid)) return false;
            unlinkSync(lockFile); // left behind by a crashed run: remove it and try again
        }
    }
    return false;
}

export function releaseLock(lockFile)
{
    try { unlinkSync(lockFile); } catch { /* already gone */ }
}
