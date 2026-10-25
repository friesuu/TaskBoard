import { useEffect, useState } from 'react';
import { getComments, addComment, updateComment, deleteComment } from '../api';
import { formatDateTime } from '../dates';

// The comments inside the task details panel: oldest first, newest at the bottom.
// Each shows who wrote it and when. Only your own comments get Edit and Delete
// (the server checks that too; hiding the buttons is just for a tidy screen).
function Comments({ taskId, currentUserId, onSessionEnded })
{
    const [comments, setComments] = useState(null); // null = still loading
    const [draft, setDraft] = useState('');
    const [editingId, setEditingId] = useState(null); // the comment being edited, if any
    const [editDraft, setEditDraft] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isStale = false;
        getComments(taskId)
            .then((list) => { if (!isStale) setComments(list); })
            .catch((err) => { if (!onSessionEnded(err)) setError(err.message); });
        return () => { isStale = true; };
    }, [taskId, onSessionEnded]);

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
            if (!onSessionEnded(err)) setError(err.message);
        }
        finally
        {
            setIsSaving(false);
        }
    };

    const handleAdd = (e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        save(async () => {
            const comment = await addComment(taskId, draft.trim());
            setComments((prev) => [...prev, comment]);
            setDraft('');
        });
    };

    const startEditing = (comment) => {
        setEditingId(comment.id);
        setEditDraft(comment.body);
    };

    const handleSaveEdit = (e) => {
        e.preventDefault();
        if (!editDraft.trim()) return;
        save(async () => {
            const updated = await updateComment(editingId, editDraft.trim());
            setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setEditingId(null);
        });
    };

    const handleDelete = (comment) => {
        if (!window.confirm('Delete this comment?')) return;
        save(async () => {
            await deleteComment(comment.id);
            setComments((prev) => prev.filter((c) => c.id !== comment.id));
        });
    };

    return(
        <section className="details-section" aria-label="Comments">
            <h3 className="details-heading">Comments</h3>

            {error && <p className="error-message">{error}</p>}
            {comments === null && !error && <p className="details-empty">Loading…</p>}
            {comments?.length === 0 && <p className="details-empty">No comments yet.</p>}

            {comments?.length > 0 && (
                <ol className="list comment-list">
                    {comments.map((c) => (
                        <li key={c.id} className="comment">
                            <div className="comment-meta">
                                <span className="comment-author" title={c.author.email}>{c.author.displayName || c.author.email}</span>
                                <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time>
                                {c.updatedAt !== c.createdAt && <span className="comment-edited">(edited)</span>}
                            </div>

                            {editingId === c.id ? (
                                <form className="comment-form" onSubmit={handleSaveEdit}>
                                    <textarea
                                        value={editDraft}
                                        onChange={(e) => setEditDraft(e.target.value)}
                                        maxLength={2000}
                                        rows={3}
                                        aria-label="Edit comment"
                                    />
                                    <div className="comment-actions">
                                        <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>
                                            Cancel
                                        </button>
                                        <button type="submit" className="btn btn-primary" disabled={isSaving || !editDraft.trim()}>
                                            Save
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <p className="comment-body">{c.body}</p>
                            )}

                            {c.author.id === currentUserId && editingId !== c.id && (
                                <div className="comment-actions">
                                    <button className="btn btn-ghost" onClick={() => startEditing(c)} aria-label="Edit comment">
                                        Edit
                                    </button>
                                    <button className="btn btn-ghost danger-text" onClick={() => handleDelete(c)} aria-label="Delete comment">
                                        Delete
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ol>
            )}

            {comments !== null && (
                <form className="comment-form" onSubmit={handleAdd}>
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={2000}
                        rows={2}
                        placeholder="Write a comment…"
                        aria-label="New comment"
                    />
                    <button type="submit" className="btn btn-secondary" disabled={isSaving || !draft.trim()}>
                        Comment
                    </button>
                </form>
            )}
        </section>
    );
}

export default Comments;
