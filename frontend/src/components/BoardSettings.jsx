import { useState } from 'react';
import BoardNameForm from './BoardNameForm';

// Settings for the board on screen: rename it, or delete it (with all its tasks).
// canDelete is false for your last board: the server refuses that anyway, this just explains it up front.
function BoardSettings({ board, canDelete, onRename, onDelete })
{
    const [error, setError] = useState(null);

    const handleDelete = async () => {
        if (!window.confirm(`Delete "${board.name}" and all its tasks? This can't be undone.`)) return;
        setError(null);
        try
        {
            await onDelete();
        }
        catch (err)
        {
            setError(err.message);
        }
    };

    return(
        <div className="board-settings">
            <BoardNameForm initialName={board.name} submitLabel="Rename" onSubmit={onRename} />

            <div className="danger-zone">
                <h3>Delete board</h3>
                {error && <p className="error-message">{error}</p>}
                <p className="profile-hint">
                    {canDelete
                        ? 'Deletes this board and every task on it.'
                        : "This is your only board, so it can't be deleted."}
                </p>
                <button className="danger-btn" onClick={handleDelete} disabled={!canDelete}>
                    Delete board
                </button>
            </div>
        </div>
    );
}

export default BoardSettings;
