import { useEffect, useState } from 'react';
import { getChecklist, addChecklistItem, updateChecklistItem, moveChecklistItem, deleteChecklistItem } from '../api';
import TrashIcon from './TrashIcon';

// The checklist inside the task details panel: add, tick, reorder (↑ ↓) and delete items.
// It loads and saves its own data. After every change it calls onProgress(done, total)
// so App can update the "2/5" on the card without asking the server again.
function Checklist({ taskId, onProgress, onSessionEnded })
{
    const [items, setItems] = useState(null); // null = still loading
    const [draft, setDraft] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isStale = false; // same idea as the board: ignore an answer for a task that's no longer open
        getChecklist(taskId)
            .then((list) => { if (!isStale) setItems(list); })
            .catch((err) => { if (!onSessionEnded(err)) setError(err.message); });
        return () => { isStale = true; };
    }, [taskId, onSessionEnded]);

    // Every change goes through here: show the new list and tell App the new counts
    const showItems = (list) => {
        setItems(list);
        onProgress(list.filter((i) => i.done).length, list.length);
    };

    // Shared error handling: an expired login goes to the login screen, anything else is shown here
    const failed = (err) => {
        if (!onSessionEnded(err)) setError(err.message);
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text) return;

        setError(null);
        setIsSaving(true);
        try
        {
            const item = await addChecklistItem(taskId, text);
            showItems([...items, item]);
            setDraft('');
        }
        catch (err)
        {
            failed(err);
        }
        finally
        {
            setIsSaving(false);
        }
    };

    // Optimistic, like dragging a card: tick it on screen first, undo if saving fails
    const handleToggle = async (item) => {
        const previous = items;
        setError(null);
        showItems(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
        try
        {
            await updateChecklistItem(item.id, { done: !item.done });
        }
        catch (err)
        {
            showItems(previous);
            failed(err);
        }
    };

    const handleMove = async (item, position) => {
        setError(null);
        try
        {
            showItems(await moveChecklistItem(item.id, position)); // the server sends back the new order
        }
        catch (err)
        {
            failed(err);
        }
    };

    const handleDelete = async (item) => {
        setError(null);
        try
        {
            await deleteChecklistItem(item.id);
            showItems(items.filter((i) => i.id !== item.id));
        }
        catch (err)
        {
            failed(err);
        }
    };

    const doneCount = items ? items.filter((i) => i.done).length : 0;

    return(
        <section className="details-section" aria-label="Checklist">
            <div className="details-section-header">
                <h3 className="details-heading">Checklist</h3>
                {items?.length > 0 && <span className="checklist-count">{doneCount}/{items.length}</span>}
            </div>

            {items?.length > 0 && (
                <div
                    className="progress-bar"
                    role="progressbar"
                    aria-label="Checklist progress"
                    aria-valuemin={0}
                    aria-valuemax={items.length}
                    aria-valuenow={doneCount}
                >
                    <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
                </div>
            )}

            {error && <p className="error-message">{error}</p>}

            {items === null ? (
                !error && <p className="details-empty">Loading…</p>
            ) : (
                <ul className="checklist-items">
                    {items.map((item, index) => (
                        <li key={item.id} className={item.done ? 'checklist-item done' : 'checklist-item'}>
                            {/* The label wraps the box, so clicking the text ticks it too */}
                            <label>
                                <input type="checkbox" checked={item.done} onChange={() => handleToggle(item)} />
                                <span>{item.text}</span>
                            </label>
                            <div className="checklist-actions">
                                <button
                                    aria-label={`Move "${item.text}" up`}
                                    disabled={index === 0}
                                    onClick={() => handleMove(item, index - 1)}
                                >↑</button>
                                <button
                                    aria-label={`Move "${item.text}" down`}
                                    disabled={index === items.length - 1}
                                    onClick={() => handleMove(item, index + 1)}
                                >↓</button>
                                <button aria-label={`Delete "${item.text}"`} onClick={() => handleDelete(item)}>
                                    <TrashIcon />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {items !== null && (
                <form className="inline-add" onSubmit={handleAdd}>
                    <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={200}
                        placeholder="Add an item…"
                        aria-label="New checklist item"
                    />
                    <button type="submit" className="add-task-btn" disabled={isSaving || !draft.trim()}>Add</button>
                </form>
            )}
        </section>
    );
}

export default Checklist;
