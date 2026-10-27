import { useState } from 'react';
import { setBoardProject } from '../api';

// "Claude project" in Board settings: which project folder the Claude runner works in for this
// board's tasks with the "AI" label. Only a name, e.g. "notes-app": the runner looks the folder up
// in its own projects.json, so nothing typed here can point it at another folder.
//   onSaved(updatedBoard): App updates its list of boards
function BoardProjectForm({ board, onSaved, onSessionEnded })
{
    const [project, setProject] = useState(board.project ?? '');
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
            const updated = await setBoardProject(board.id, project);
            setProject(updated.project ?? '');
            setIsSaved(true);
            onSaved(updated);
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
        <form className="card settings-form" onSubmit={handleSubmit}>
            <h3>Claude project</h3>
            {error && <p className="error-message">{error}</p>}
            {isSaved && <p className="success-message">Saved</p>}
            <div className="field">
                <label htmlFor="board-project">Project name</label>
                <input
                    id="board-project"
                    value={project}
                    maxLength={50}
                    placeholder="notes-app"
                    onChange={(e) => { setProject(e.target.value); setIsSaved(false); }}
                />
                <p className="profile-hint">
                    The project Claude works in for this board&apos;s tasks with the &quot;AI&quot; label: a name from the
                    runner&apos;s projects.json. Leave it empty to keep Claude off this board.
                </p>
            </div>
            <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save project'}
                </button>
            </div>
        </form>
    );
}

export default BoardProjectForm;
