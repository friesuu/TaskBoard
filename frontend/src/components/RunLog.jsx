import { useEffect, useState } from 'react';
import { getRunLog } from '../api';

// Who said each line
const KIND_LABELS = { info: 'runner', claude: 'Claude', thinking: 'thinks', tool: 'tool', check: 'check', error: 'error' };

const timeOf = (isoString) =>
    new Date(isoString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// One run's step-by-step log: what Claude said, thought and did, and the runner's own steps (setup, checks,
// commit), in a monospace block with a Copy button. Loaded when it's opened. Nothing updates by itself:
// a run that's still going has a Refresh button.
//   runId: the run; isRunning: show Refresh
//   onSessionEnded(err): an expired login goes back to the login screen
function RunLog({ runId, isRunning = false, onSessionEnded })
{
    const [lines, setLines] = useState(null); // null = loading
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);
    const [version, setVersion] = useState(0); // goes up on Refresh: the log loads again

    useEffect(() => {
        let isStale = false; // a late answer for a log you've closed is ignored
        getRunLog(runId)
            .then((list) => {
                if (isStale) return;
                setLines(list);
                setError(null);
            })
            .catch((err) => { if (!isStale && !onSessionEnded(err)) setError(err.message); });
        return () => { isStale = true; };
    }, [runId, version, onSessionEnded]);

    const asText = () => (lines ?? []).map((l) => `${timeOf(l.at)}  ${KIND_LABELS[l.kind] ?? l.kind}  ${l.text}`).join('\n');

    const copy = async () => {
        try
        {
            await navigator.clipboard.writeText(asText());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
        catch
        {
            setError("Couldn't copy: select the log and copy it yourself.");
        }
    };

    return(
        <div className="run-log">
            <div className="run-log-actions">
                {isRunning && <button type="button" className="text-btn" onClick={() => setVersion((v) => v + 1)}>Refresh</button>}
                <button type="button" className="text-btn" onClick={copy} disabled={!lines?.length}>
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            {error && <p className="error-message">{error}</p>}
            {lines === null && !error && <p className="details-empty">Loading…</p>}
            {lines?.length === 0 && <p className="details-empty">Nothing was logged for this run.</p>}
            {lines?.length > 0 && (
                // tabIndex: a scrolling block must be reachable with the keyboard
                <pre className="run-log-text" tabIndex={0} aria-label="Step-by-step log">
                    {lines.map((l) => (
                        <span key={l.id} className={`run-log-line kind-${l.kind}`}>
                            <span className="run-log-time">{timeOf(l.at)}</span>
                            <span className="run-log-kind">{KIND_LABELS[l.kind] ?? l.kind}</span>
                            <span className="run-log-body">{l.text}</span>
                        </span>
                    ))}
                </pre>
            )}
        </div>
    );
}

export default RunLog;
