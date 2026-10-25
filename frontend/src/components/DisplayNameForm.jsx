import { useState } from 'react';
import { setDisplayName } from '../api';

// "Display name" on the profile: the name shown instead of your email. Empty = show the email again.
// onSaved({ displayName }): App updates the user, so the menu shows the new name straight away.
function DisplayNameForm({ user, onSaved, onSessionEnded })
{
    const [name, setName] = useState(user.displayName ?? '');
    const [error, setError] = useState(null);
    const [isSaved, setIsSaved] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsSaved(false);
        setIsSaving(true);
        try
        {
            const saved = await setDisplayName(name); // the server trims it; '' comes back as null
            setName(saved ?? '');
            setIsSaved(true);
            onSaved({ displayName: saved });
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message);
        }
        finally
        {
            setIsSaving(false);
        }
    };

    return(
        <form className="settings-form" onSubmit={handleSubmit}>
            {error && <p className="error-message">{error}</p>}
            {isSaved && <p className="success-message">Saved</p>}
            <div className="field">
                <label htmlFor="profile-name">Display name</label>
                <input
                    id="profile-name"
                    value={name}
                    maxLength={50}
                    autoComplete="name"
                    placeholder="Sam Lee"
                    onChange={(e) => { setName(e.target.value); setIsSaved(false); }}
                />
                <p className="profile-hint">Shown instead of your email in the menu and on your comments. Leave it empty to show your email.</p>
            </div>
            <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save name'}
                </button>
            </div>
        </form>
    );
}

export default DisplayNameForm;
