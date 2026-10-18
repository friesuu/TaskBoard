import { STATUSES } from "../statuses";
import { isOverdue } from "../dates";
import { ArrowLeftIcon } from "./Icons";

// The profile page. Everything here comes from data App already has (the user and the open board's tasks),
// so it needs no extra request to the server.
function Profile({ user, tasks, boardName, onBack, onChangePassword })
{
    // How many tasks are in each column, e.g. { TODO: 3, IN_PROGRESS: 1, DONE: 6 }
    const countByStatus = Object.fromEntries(
        STATUSES.map((s) => [s.value, tasks.filter((t) => t.status === s.value).length]),
    );
    const overdueCount = tasks.filter(isOverdue).length;

    return(
        <section className="profile">
            <button className="btn btn-ghost back-link" onClick={onBack}>
                <ArrowLeftIcon size={16} />
                Back to board
            </button>

            <div className="card profile-card">
                {/* The first letter of the email, as a simple picture */}
                <div className="avatar" aria-hidden="true">{user.email[0].toUpperCase()}</div>
                <div className="profile-identity">
                    <h2 className="profile-email">{user.email}</h2>
                    <p className="profile-label">Your account</p>
                </div>
            </div>

            <h2 className="profile-heading">{boardName ? `Tasks on "${boardName}"` : 'Your tasks'}</h2>
            {/* Each number has a coloured dot: the same status colours as the board */}
            <div className="stat-grid">
                <div className="card stat">
                    <span className="stat-label"><span className="dot dot-neutral" aria-hidden="true" />Total</span>
                    <span className="stat-number">{tasks.length}</span>
                </div>
                {STATUSES.map((s) => (
                    <div className="card stat" key={s.value}>
                        <span className="stat-label"><span className={`dot dot-${s.tone}`} aria-hidden="true" />{s.label}</span>
                        <span className="stat-number">{countByStatus[s.value]}</span>
                    </div>
                ))}
                <div className={overdueCount > 0 ? 'card stat overdue' : 'card stat'}>
                    <span className="stat-label"><span className="dot dot-danger" aria-hidden="true" />Overdue</span>
                    <span className="stat-number">{overdueCount}</span>
                </div>
            </div>

            <h2 className="profile-heading">Security</h2>
            <div className="card profile-actions">
                <button className="btn btn-secondary" onClick={onChangePassword}>Change password</button>
                <p className="profile-hint">Changing your password logs you out on every other device.</p>
            </div>
        </section>
    );
}

export default Profile;
