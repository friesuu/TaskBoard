import { useState } from 'react';
import { createLabel, updateLabel, deleteLabel } from '../api';
import { sortLabels } from '../labelColors';
import LabelPill from './LabelPill';
import ColorPicker from './ColorPicker';
import TrashIcon from './TrashIcon';

// The "Labels" part of Board settings: add, rename, recolour and delete the board's labels.
// It saves through the API itself, then calls onLabelsChanged(newList) so App can update
// the labels everywhere (including on the cards that use them).
function LabelManager({ boardId, labels, onLabelsChanged, onSessionEnded })
{
    const [name, setName] = useState('');
    const [color, setColor] = useState('BLUE');
    const [editingId, setEditingId] = useState(null); // the label being edited, if any
    const [editName, setEditName] = useState('');
    const [editColor, setEditColor] = useState('BLUE');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    // Runs a save: shows "busy", and handles errors the same way every time
    const save = async (action) => {
        setError(null);
        setIsSaving(true);
        try
        {
            await action();
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message); // e.g. 'There is already a label called "Urgent"...'
        }
        finally
        {
            setIsSaving(false);
        }
    };

    const handleAdd = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        save(async () => {
            const created = await createLabel(boardId, name.trim(), color);
            onLabelsChanged(sortLabels([...labels, created]));
            setName('');
        });
    };

    const startEditing = (label) => {
        setEditingId(label.id);
        setEditName(label.name);
        setEditColor(label.color);
    };

    const handleSaveEdit = (e) => {
        e.preventDefault();
        if (!editName.trim()) return;
        save(async () => {
            const updated = await updateLabel(editingId, { name: editName.trim(), color: editColor });
            onLabelsChanged(sortLabels(labels.map((l) => (l.id === updated.id ? updated : l))));
            setEditingId(null);
        });
    };

    const handleDelete = (label) => {
        if (!window.confirm(`Delete the label "${label.name}"? It will be taken off every task that has it.`)) return;
        save(async () => {
            await deleteLabel(label.id);
            onLabelsChanged(labels.filter((l) => l.id !== label.id));
        });
    };

    return(
        <section className="label-manager" aria-label="Labels">
            <h3>Labels</h3>

            {error && <p className="error-message">{error}</p>}

            {labels.length === 0 ? (
                <p className="profile-hint">No labels yet. Add one below.</p>
            ) : (
                <ul className="list label-list">
                    {labels.map((l) => (
                        <li key={l.id} className="label-row">
                            {editingId === l.id ? (
                                <form className="label-form" onSubmit={handleSaveEdit}>
                                    <input
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        maxLength={30}
                                        aria-label="Label name"
                                        autoFocus
                                    />
                                    <ColorPicker name={`label-color-${l.id}`} value={editColor} onChange={setEditColor} />
                                    <div className="form-actions">
                                        <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>
                                            Cancel
                                        </button>
                                        <button type="submit" className="btn btn-primary" disabled={isSaving || !editName.trim()}>
                                            Save
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <>
                                    <LabelPill label={l} />
                                    <div className="label-row-actions">
                                        <button
                                            className="btn btn-ghost"
                                            onClick={() => startEditing(l)}
                                            aria-label={`Edit label "${l.name}"`}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="icon-btn icon-btn-danger"
                                            onClick={() => handleDelete(l)}
                                            aria-label={`Delete label "${l.name}"`}
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <form className="label-form" onSubmit={handleAdd}>
                <div className="field">
                    <label htmlFor="new-label-name">New label</label>
                    <input
                        id="new-label-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={30}
                        placeholder="e.g. Urgent"
                    />
                </div>
                <ColorPicker name="new-label-color" value={color} onChange={setColor} />
                <div className="form-actions">
                    <button type="submit" className="btn btn-secondary" disabled={isSaving || !name.trim()}>
                        Add label
                    </button>
                </div>
            </form>
        </section>
    );
}

export default LabelManager;
