import { useState } from "react";

// Shown in the modal. onChangePassword comes from App, which calls the API and handles
// an expired session. If it throws, this form shows the error.
function ChangePasswordForm({ email, onChangePassword })
{
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        // Only checked here: a typo in the new password would lock you out. The server never sees "confirm".
        if (newPassword !== confirmPassword)
        {
            setError("The new passwords don't match");
            return;
        }

        setIsSubmitting(true);
        try
        {
            await onChangePassword(currentPassword, newPassword); // App closes the modal on success
        }
        catch (err)
        {
            setError(err.message); // e.g. "Current password is incorrect"
            setIsSubmitting(false);
        }
    };

    return(
        <form onSubmit={handleSubmit} className="task-form">
            {error && <div className="error-message">{error}</div>}

            {/* Read-only. autoComplete="username" tells a password manager WHICH saved login to update */}
            <div className="field">
                <label htmlFor="cp-email">Account</label>
                <input id="cp-email" type="email" autoComplete="username" value={email} readOnly />
            </div>

            <div className="field">
                <label htmlFor="cp-current">Current password</label>
                <input
                    id="cp-current"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                />
            </div>

            <div className="field">
                <label htmlFor="cp-new">New password (at least 8 characters)</label>
                <input
                    id="cp-new"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                />
            </div>

            <div className="field">
                <label htmlFor="cp-confirm">Repeat new password</label>
                <input
                    id="cp-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                />
            </div>

            <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>Change password</button>
            </div>
        </form>
    );
}

export default ChangePasswordForm;
