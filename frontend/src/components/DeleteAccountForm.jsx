import { useState } from 'react';
import { deleteAccount } from '../api';
import TrashIcon from './TrashIcon';

// "Delete account" on the profile. Asks for your password (the server checks it) and then once more
// to be sure, because it can't be undone. onDeleted(): App goes back to the login screen.
function DeleteAccountForm({ onDeleted, onSessionEnded })
{
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!password)
        {
            setError('Enter your password first');
            return;
        }
        if (!window.confirm("Delete your account and everything in it? This can't be undone.")) return;

        setIsDeleting(true);
        try
        {
            await deleteAccount(password);
            onDeleted();
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message); // e.g. "Password is incorrect"
            setIsDeleting(false);
        }
    };

    return(
        <form className="settings-form" onSubmit={handleSubmit}>
            <p className="profile-hint">
                This deletes your account, all your boards and tasks, your comments, your chat with the assistant
                and your uploaded files. It can&apos;t be undone.
            </p>
            {error && <p className="error-message">{error}</p>}
            <div className="field">
                <label htmlFor="profile-delete-password">Your password</label>
                <input
                    id="profile-delete-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            </div>
            <div className="form-actions">
                <button type="submit" className="btn btn-danger" disabled={isDeleting}>
                    <TrashIcon />
                    {isDeleting ? 'Deleting…' : 'Delete my account'}
                </button>
            </div>
        </form>
    );
}

export default DeleteAccountForm;
