import { Fragment, useCallback, useEffect, useState } from 'react';
import { getAiRuns } from '../api';
import { formatDateTime } from '../dates';
import { RUN_TONES, STEP_NAMES, durationOf, runResultText, timeAgo } from '../aiState';
import { ChevronDownIcon } from './Icons';
import RunLog from './RunLog';

const FILTERS = [
    { value: null, label: 'All' },
    { value: 'running', label: 'Running' },
    { value: 'succeeded', label: 'Succeeded' },
    { value: 'failed', label: 'Failed' },
];

// What your runner is doing, at the top of the page. It runs on your laptop, so "offline" is normal:
// it looks calm, not like an error.
export function AgentBanner({ status })
{
    if (!status) return null;
    let tone = 'neutral';
    let title;
    let note;
    let live = false;

    switch (status.state)
    {
        case 'working':
            tone = 'ai';
            live = true;
            title = status.task ? `Working on #${status.task.id} ${status.task.title}` : 'Working';
            note = [STEP_NAMES[status.step], status.stateSince && `for ${durationOf({ startedAt: status.stateSince })}`]
                .filter(Boolean).join(' · ');
            break;
        case 'idle':
            tone = 'success';
            title = 'Idle';
            note = `Waiting for AI tasks · checked ${timeAgo(status.lastSeenAt)}`;
            break;
        case 'paused':
            tone = 'warning';
            title = 'Usage limit reached';
            note = status.pausedUntil ? `Resumes ${formatDateTime(status.pausedUntil)}` : 'Resumes when the limit resets';
            break;
        case 'capped':
            tone = 'warning';
            title = "Today's spend cap is used up";
            note = 'It carries on tomorrow';
            break;
        case 'unplugged':
            title = 'On battery';
            note = 'Nothing starts until the laptop is plugged in';
            break;
        case 'offline':
            title = 'Offline';
            note = `Last seen ${timeAgo(status.lastSeenAt)}. The runner lives on your laptop: it picks up waiting tasks when it's back.`;
            break;
        default: // never
            title = 'Not connected yet';
            note = 'Start the runner on your laptop (see runner/README.md). It shows up here once it checks in.';
    }

    return(
        <div className={`agent-banner tone-${tone}`}>
            <span className={`dot dot-${tone}${live ? ' pulsing' : ''}`} aria-hidden="true" />
            <div className="agent-banner-text">
                <strong>{title}</strong>
                {note && <span className="agent-banner-note">{note}</span>}
            </div>
        </div>
    );
}

// The AI Activity page: the runner's status, and every run on every board, newest first. Filter by result;
// click a run for its step-by-step log. Nothing updates by itself: Refresh, or come back to the tab.
//   agentStatus: what the runner is doing (App loads it)
//   onRefresh(): App reloads the runner's status and the bell
//   onOpenTask(task): App opens the task's AI tab
function AiActivity({ agentStatus, onRefresh = () => {}, onOpenTask, onSessionEnded })
{
    const [filter, setFilter] = useState(null);
    const [runs, setRuns] = useState(null); // null = loading
    const [error, setError] = useState(null);
    const [openRunId, setOpenRunId] = useState(null);
    const [version, setVersion] = useState(0); // goes up on Refresh

    useEffect(() => {
        let isStale = false;
        getAiRuns(filter)
            .then((list) => {
                if (isStale) return;
                setRuns(list);
                setError(null);
            })
            .catch((err) => { if (!isStale && !onSessionEnded(err)) setError(err.message); });
        return () => { isStale = true; };
    }, [filter, version, onSessionEnded]);

    const refresh = useCallback(() => {
        setVersion((v) => v + 1);
        onRefresh();
    }, [onRefresh]);

    const choose = (value) => {
        setRuns(null);
        setOpenRunId(null);
        setFilter(value);
    };

    return(
        <div className="ai-activity">
            <AgentBanner status={agentStatus} />

            <div className="ai-activity-bar">
                <div className="segmented" role="group" aria-label="Show runs">
                    {FILTERS.map((f) => (
                        <button
                            key={f.label}
                            className={filter === f.value ? 'segment active' : 'segment'}
                            aria-pressed={filter === f.value}
                            onClick={() => choose(f.value)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <button className="btn btn-secondary" onClick={refresh}>Refresh</button>
            </div>

            {error && <p className="error-message">{error}</p>}
            {runs === null && !error && <p className="details-empty">Loading…</p>}
            {runs?.length === 0 && (
                <div className="ai-empty">
                    {filter === null ? (
                        <>
                            <p className="ai-empty-title">Nothing has run yet</p>
                            <p className="details-empty">
                                Give a task the AI label, on a board with a project, and the runner picks it up.
                            </p>
                        </>
                    ) : (
                        <p className="details-empty">No {filter} runs.</p>
                    )}
                </div>
            )}
            {runs?.length > 0 && (
                <table className="ai-runs-table">
                    <thead>
                        <tr>
                            <th scope="col">Task</th>
                            <th scope="col">Project</th>
                            <th scope="col">Branch</th>
                            <th scope="col">Started</th>
                            <th scope="col">Time</th>
                            <th scope="col">Result</th>
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map((run) => {
                            const isOpen = openRunId === run.id;
                            const tone = RUN_TONES[run.status] ?? 'neutral';
                            return(
                                <Fragment key={run.id}>
                                    <tr className={isOpen ? 'ai-runs-row open' : 'ai-runs-row'}>
                                        <td>
                                            <button
                                                type="button"
                                                className="ai-run-toggle"
                                                aria-expanded={isOpen}
                                                onClick={() => setOpenRunId(isOpen ? null : run.id)}
                                            >
                                                <ChevronDownIcon size={16} />
                                                <span className="ai-runs-task">#{run.task.id} {run.task.title}</span>
                                            </button>
                                        </td>
                                        <td>{run.project ?? '—'}</td>
                                        <td>{run.branch ? <code className="ai-code">{run.branch}</code> : '—'}</td>
                                        <td>{formatDateTime(run.startedAt)}</td>
                                        <td>{durationOf(run)}</td>
                                        <td>
                                            <span className={run.status === 'failed' ? 'pill ai-chip danger' : 'pill ai-chip'}>
                                                <span
                                                    className={`dot dot-${tone}${run.status === 'running' ? ' pulsing' : ''}`}
                                                    aria-hidden="true"
                                                />
                                                {runResultText(run)}
                                            </span>
                                        </td>
                                    </tr>
                                    {isOpen && (
                                        <tr className="ai-runs-detail">
                                            <td colSpan={6}>
                                                <div className="ai-runs-detail-head">
                                                    <span>{STEP_NAMES[run.step] ?? run.step}</span>
                                                    {run.error && <span className="ai-run-error">{run.error}</span>}
                                                    <button type="button" className="text-btn" onClick={() => onOpenTask(run.task)}>
                                                        Open task
                                                    </button>
                                                </div>
                                                <RunLog runId={run.id} isRunning={run.status === 'running'} onSessionEnded={onSessionEnded} />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
}

export default AiActivity;
