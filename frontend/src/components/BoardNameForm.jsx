import { useState } from 'react';

// One field: a board's name. Used for "New board" and for renaming in Board settings.
// onSubmit is App's handler; if it throws, the message is shown here.
function BoardNameForm({ initialName = '', submitLabel, onSubmit })
{
    const [name, setName] = useState(initialName);
    const [error, setError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setIsSaving(true);
        try
        {
            await onSubmit(name.trim());
        }
        catch (err)
        {
            setError(err.message);
        }
        finally
        {
            setIsSaving(false);
        }
    };

    return(
        <form onSubmit={handleSubmit} className="task-form">
            {error && <div className="error-message">{error}</div>}

            <div className="field">
                <label htmlFor="board-name">Board name</label>
                <input
                    id="board-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                    autoFocus
                />
            </div>

            <button type="submit" disabled={isSaving || !name.trim()}>{submitLabel}</button>
        </form>
    );
}

export default BoardNameForm;
