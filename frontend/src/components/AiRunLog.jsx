import { useState } from 'react';
import { getAgentRuns } from '../api';
import { formatDateTime } from '../dates';

const STEP_NAMES = { refine: 'Wrote the prompt', build: 'Built it' };

// "Run log" at the bottom of the Claude section: every step the runner took on this task, newest first,
// with what happened and what it cost. Folded away until you open it (and only loaded then).
function AiRunLog({ taskId, onSessionEnded })
{
    const [runs, setRuns] = useState(null); // null = not loaded yet
    const [error, setError] = useState(null);

    const handleToggle = (e) => {
        if (!e.currentTarget.open) return;
        setError(null);
        getAgentRuns(taskId)
            .then(setRuns)
            .catch((err) => { if (!onSessionEnded(err)) setError(err.message); });
    };

    return(
        <details className="ai-run-log" onToggle={handleToggle}>
            <summary>Run log</summary>
            {error && <p className="error-message">{error}</p>}
            {runs === null && !error && <p className="details-empty">Loading…</p>}
            {runs?.length === 0 && <p className="details-empty">No runs yet.</p>}
            {runs?.length > 0 && (
                <ol className="ai-runs">
                    {runs.map((run) => (
                        <li key={run.id} className="ai-run">
                            <div className="ai-run-head">
                                <span className="ai-run-step">{STEP_NAMES[run.step] ?? run.step}</span>
                                <span className={run.error || run.checksPassed === false ? 'ai-run-result bad' : 'ai-run-result'}>
                                    {run.result}
                                    {run.checksPassed === true && ' · checks passed'}
                                    {run.checksPassed === false && ' · checks failed'}
                                </span>
                            </div>
                            <div className="ai-run-meta">
                                <time dateTime={run.finishedAt}>{formatDateTime(run.finishedAt)}</time>
                                {run.costUsd !== null && <span>${run.costUsd.toFixed(2)}</span>}
                                {run.branch && <code className="ai-code">{run.branch}</code>}
                            </div>
                            {run.error && <p className="ai-run-error">{run.error}</p>}
                        </li>
                    ))}
                </ol>
            )}
        </details>
    );
}

export default AiRunLog;
