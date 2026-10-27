import { useEffect, useState } from "react";
import { getTaskStats } from "../api";
import { ArrowLeftIcon } from "./Icons";
import ProfileRow from "./ProfileRow";
import TaskStatsPanel from "./TaskStatsPanel";
import DisplayNameForm from "./DisplayNameForm";
import TimeZoneForm from "./TimeZoneForm";
import DeleteAccountForm from "./DeleteAccountForm";
import RunnerTokenPanel from "./RunnerTokenPanel";

// "1 task", "12 tasks"
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The profile page: who you are, then a settings list (like the calorie tracker's). Each row shows a short
// preview and opens under itself like a dropdown, one at a time. "Your tasks" starts open.
//   onUserChange(changes): App merges a saved display name or time zone into the user
//   onAccountDeleted(): App goes back to the login screen
//   onChangePassword(): App opens the change password form
function Profile({ user, onBack, onChangePassword, onUserChange, onAccountDeleted, onSessionEnded })
{
    const [openRow, setOpenRow] = useState('tasks');
    const [stats, setStats] = useState(null); // null while loading
    const [statsError, setStatsError] = useState(null);

    // The numbers across all your boards, loaded when the page opens
    useEffect(() => {
        let isStale = false;
        getTaskStats()
            .then((loaded) => { if (!isStale) setStats(loaded); })
            .catch((err) => { if (!onSessionEnded(err)) setStatsError(err.message); });
        return () => { isStale = true; };
    }, [onSessionEnded]);

    const toggle = (row) => setOpenRow(openRow === row ? null : row);
    const rowProps = (row) => ({ id: row, isOpen: openRow === row, onToggle: () => toggle(row) });

    const name = user.displayName || user.email;
    const statsPreview = stats
        ? `${plural(stats.total, 'task')} · ${stats.done} done · ${stats.overdue} overdue`
        : 'Across all your boards';

    return(
        <section className="profile">
            <button className="btn btn-ghost back-link" onClick={onBack}>
                <ArrowLeftIcon size={16} />
                Back to board
            </button>

            <div className="card profile-card">
                {/* The first letter of your name (or email), as a simple picture */}
                <div className="avatar" aria-hidden="true">{name[0].toUpperCase()}</div>
                <div className="profile-identity">
                    <h2 className="profile-email">{name}</h2>
                    <p className="profile-label">{user.displayName ? user.email : 'Your account'}</p>
                </div>
            </div>

            <ul className="card settings-list" aria-label="Profile settings">
                <ProfileRow {...rowProps('tasks')} label="Your tasks" preview={statsPreview}>
                    <TaskStatsPanel stats={stats} error={statsError} />
                </ProfileRow>

                <ProfileRow {...rowProps('name')} label="Display name" preview={user.displayName ?? 'Not set: your email is shown'}>
                    <DisplayNameForm user={user} onSaved={onUserChange} onSessionEnded={onSessionEnded} />
                </ProfileRow>

                <ProfileRow {...rowProps('zone')} label="Time zone" preview={user.timeZone ?? 'Not set: UTC is used'}>
                    <TimeZoneForm user={user} onSaved={onUserChange} onSessionEnded={onSessionEnded} />
                </ProfileRow>

                <ProfileRow {...rowProps('password')} label="Password" preview="Change your password">
                    <div className="settings-form">
                        <p className="profile-hint">Changing your password logs you out on every other device.</p>
                        <div className="form-actions">
                            <button className="btn btn-secondary" onClick={onChangePassword}>Change password</button>
                        </div>
                    </div>
                </ProfileRow>

                <ProfileRow {...rowProps('runner')} label="Runner token" preview="Lets the Claude runner reach your AI tasks">
                    <RunnerTokenPanel onSessionEnded={onSessionEnded} />
                </ProfileRow>

                <ProfileRow {...rowProps('delete')} label="Delete account" preview="Remove your account and everything in it" danger>
                    <DeleteAccountForm onDeleted={onAccountDeleted} onSessionEnded={onSessionEnded} />
                </ProfileRow>
            </ul>
        </section>
    );
}

export default Profile;
