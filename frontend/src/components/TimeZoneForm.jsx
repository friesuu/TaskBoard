import { useMemo, useState } from 'react';
import { setTimeZone } from '../api';

// Every time zone the browser knows, A to Z, plus UTC and the saved one if they're missing from that list
function timeZoneList(saved)
{
    const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return [...new Set([...known, 'UTC', saved].filter(Boolean))].sort();
}

// "Asia/Kuala_Lumpur" -> "Asia/Kuala Lumpur"
const readable = (zone) => zone.replaceAll('_', ' ');

// "Time zone" on the profile. It decides when a task counts as overdue and what "this week" is.
// The app fills it in from your browser the first time you log in; after that it's only changed here.
// onSaved({ timeZone }): App updates the user (and reloads the tasks, so "overdue" uses the new zone).
function TimeZoneForm({ user, onSaved, onSessionEnded })
{
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zones = useMemo(() => timeZoneList(user.timeZone), [user.timeZone]);
    const [zone, setZone] = useState(user.timeZone ?? browserZone);
    const [error, setError] = useState(null);
    const [isSaved, setIsSaved] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const choose = (next) => {
        setZone(next);
        setIsSaved(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsSaving(true);
        try
        {
            await setTimeZone(zone);
            setIsSaved(true);
            onSaved({ timeZone: zone });
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
                <label htmlFor="profile-zone">Time zone</label>
                <select id="profile-zone" value={zone} onChange={(e) => choose(e.target.value)}>
                    {zones.map((z) => <option key={z} value={z}>{readable(z)}</option>)}
                </select>
                <p className="profile-hint">Decides when a task is overdue and what counts as this week.</p>
            </div>
            <div className="form-actions">
                {browserZone && zone !== browserZone && (
                    <button type="button" className="btn btn-secondary" onClick={() => choose(browserZone)}>
                        Use this device's ({readable(browserZone)})
                    </button>
                )}
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save time zone'}
                </button>
            </div>
        </form>
    );
}

export default TimeZoneForm;
