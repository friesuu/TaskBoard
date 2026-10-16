import { STATUSES } from "../statuses";
import { isOverdue } from "../dates";

// The profile page. Everything here comes from data App already has (the user and their tasks),
// so it needs no extra request to the server.
function Profile({ user, tasks, onBack, onChangePassword })
{
    // How many tasks are in each column, e.g. { TODO: 3, IN_PROGRESS: 1, DONE: 6 }
    const countByStatus = Object.fromEntries(
        STATUSES.map((s) => [s.value, tasks.filter((t) => t.status === s.value).length]),
    );
    const overdueCount = tasks.filter(isOverdue).length;

    return(
        <section className="profile">
            <button className="back-link" onClick={onBack}>← Back to board</button>

            <div className="profile-card">
                {/* The first letter of the email, as a simple picture */}
                <div className="avatar" aria-hidden="true">{user.email[0].toUpperCase()}</div>
                <div>
                    <h2 className="profile-email">{user.email}</h2>
                    <p className="profile-label">Your account</p>
                </div>
            </div>

            <h3 className="profile-heading">Your tasks</h3>
            <div className="stat-grid">
                <div className="stat">
                    <span className="stat-number">{tasks.length}</span>
                    <span className="stat-label">Total</span>
                </div>
                {STATUSES.map((s) => (
                    <div className="stat" key={s.value}>
                        <span className="stat-number">{countByStatus[s.value]}</span>
                        <span className="stat-label">{s.label}</span>
                    </div>
                ))}
                <div className={overdueCount > 0 ? 'stat overdue' : 'stat'}>
                    <span className="stat-number">{overdueCount}</span>
                    <span className="stat-label">Overdue</span>
                </div>
            </div>

            <h3 className="profile-heading">Security</h3>
            <div className="profile-actions">
                <button className="logout-btn" onClick={onChangePassword}>Change password</button>
                <p className="profile-hint">Changing your password logs you out on every other device.</p>
            </div>
        </section>
    );
}

export default Profile;
