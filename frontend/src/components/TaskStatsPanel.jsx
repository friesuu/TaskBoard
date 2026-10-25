import { STATUSES } from '../statuses';

// Which number in the stats goes with each column
const COUNT_OF = { TODO: 'todo', IN_PROGRESS: 'inProgress', DONE: 'done' };

// "Your tasks" on the profile: how much is done, the numbers per column, and this week.
// stats: from getTaskStats (all your boards), null while loading. error: why loading failed.
function TaskStatsPanel({ stats, error })
{
    if (error) return <p className="error-message">{error}</p>;
    if (!stats) return <p className="details-empty">Loading…</p>;

    const percentDone = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);

    return(
        <div className="task-stats">
            <div className="stats-progress">
                <div className="stats-progress-text">
                    <span>{stats.done} of {stats.total} done</span>
                    <span>{percentDone}%</span>
                </div>
                <div
                    className="progress-bar"
                    role="progressbar"
                    aria-label="Tasks done"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percentDone}
                >
                    <div style={{ width: `${percentDone}%` }} />
                </div>
            </div>

            {/* Each number has a coloured dot: the same status colours as the board */}
            <div className="stat-grid">
                {STATUSES.map((s) => (
                    <div className="card stat" key={s.value}>
                        <span className="stat-label"><span className={`dot dot-${s.tone}`} aria-hidden="true" />{s.label}</span>
                        <span className="stat-number">{stats[COUNT_OF[s.value]]}</span>
                    </div>
                ))}
                <div className={stats.overdue > 0 ? 'card stat overdue' : 'card stat'}>
                    <span className="stat-label"><span className="dot dot-danger" aria-hidden="true" />Overdue</span>
                    <span className="stat-number">{stats.overdue}</span>
                </div>
            </div>

            <h3 className="stats-week-title">This week</h3>
            <div className="stat-grid stat-grid-week">
                <div className="card stat">
                    <span className="stat-label">Due this week</span>
                    <span className="stat-number">{stats.dueThisWeek}</span>
                </div>
                <div className="card stat">
                    <span className="stat-label">Finished this week</span>
                    <span className="stat-number">{stats.doneThisWeek}</span>
                </div>
            </div>
        </div>
    );
}

export default TaskStatsPanel;
