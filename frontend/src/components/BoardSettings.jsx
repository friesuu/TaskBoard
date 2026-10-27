import { useState } from 'react';
import BoardNameForm from './BoardNameForm';
import LabelManager from './LabelManager';
import BoardProjectForm from './BoardProjectForm';

// Settings for the board on screen: rename it, or delete it (with all its tasks).
// canDelete is false for your last board: the server refuses that anyway, this just explains it up front.
// labels / onLabelsChanged / onSessionEnded are for the Labels section (LabelManager).
// onProjectChanged(updatedBoard): App updates the board after its Claude project changes.
function BoardSettings({
    board, canDelete, onRename, onDelete, labels = [], onLabelsChanged, onProjectChanged = () => {}, onSessionEnded,
})
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

            <LabelManager
                boardId={board.id}
                labels={labels}
                onLabelsChanged={onLabelsChanged}
                onSessionEnded={onSessionEnded}
            />

            <BoardProjectForm board={board} onSaved={onProjectChanged} onSessionEnded={onSessionEnded} />

            <div className="card danger-zone">
                <h3>Delete board</h3>
                {error && <p className="error-message">{error}</p>}
                <p className="profile-hint">
                    {canDelete
                        ? 'Deletes this board and every task on it.'
                        : "This is your only board, so it can't be deleted."}
                </p>
                <button className="btn btn-danger" onClick={handleDelete} disabled={!canDelete}>
                    Delete board
                </button>
            </div>
        </div>
    );
}

export default BoardSettings;
