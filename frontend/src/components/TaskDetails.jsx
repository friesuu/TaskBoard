import { useEffect, useState } from 'react';
import TaskEditForm from './TaskEditForm';
import Checklist from './Checklist';
import Comments from './Comments';
import TaskLabels from './TaskLabels';
import { STATUSES } from '../statuses';
import { formatDueDate, isOverdue } from '../dates';
import { CalendarIcon, CloseIcon } from './Icons';
import Attachments from './Attachments';
import TrashIcon from './TrashIcon';

// The panel that opens when you click a task: details + notes (editable), checklist, comments.
// App decides WHICH task is open and passes it in; everything here works on that one task.
//   onSave(taskId, changes)                 -> App's handleEdit (saves title / notes / due date)
//   onChecklistProgress(taskId, done, total) -> App updates the "2/5" on the card
//   onSessionEnded(err)                      -> App's endedSession (expired login -> login screen)
//   onClose()                                -> App closes the panel
//   boardLabels                              -> the board's labels, to choose from
//   onTaskChanged(updatedTask)               -> App puts the task's new labels on its card
//   onAttachmentCount(taskId, count)         -> App updates the 📎 count on the card
//   onStatusChange(taskId, status)           -> App moves it to the bottom of another column
//   onDelete(taskId)                         -> App deletes it (the panel then closes)
function TaskDetails({
    task, currentUserId, onSave, onChecklistProgress, onSessionEnded, onClose,
    boardLabels = [], onTaskChanged, onAttachmentCount = () => {},
    onStatusChange = () => {}, onDelete = () => {},
})
{
    const [isEditing, setIsEditing] = useState(false);

    // Escape closes the panel (unless you're typing in the edit form, where Escape shouldn't lose your changes)
    useEffect(() => {
        if (isEditing) return;
        const handleKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [isEditing, onClose]);

    // Errors are thrown on to TaskEditForm, which shows them
    const handleSave = async (changes) => {
        await onSave(task.id, changes);
        setIsEditing(false);
    };

    const handleDelete = () => {
        if (window.confirm(`Delete "${task.title}"?`)) onDelete(task.id);
    };

    const overdue = isOverdue(task);

    return(
        <div className="modal-backdrop" onClick={onClose}>
            <div
                className="modal modal-wide"
                role="dialog"
                aria-modal="true"
                aria-labelledby="task-details-title"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="modal-header">
                    <h2 id="task-details-title">{task.title}</h2>
                    <button className="icon-btn" onClick={onClose} aria-label="Close task"><CloseIcon /></button>
                </header>

                <div className="modal-body task-details-body">
                    {isEditing ? (
                        <TaskEditForm task={task} onSave={handleSave} onCancel={() => setIsEditing(false)} />
                    ) : (
                        <section className="details-section">
                            <div className="details-meta">
                                {/* Which column it's in, and moving it to another one (it lands at the bottom) */}
                                <select
                                    className="details-column"
                                    value={task.status}
                                    onChange={(e) => onStatusChange(task.id, e.target.value)}
                                    aria-label="Column"
                                >
                                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                                {task.dueDate && (
                                    <span className={overdue ? 'details-due overdue' : 'details-due'}>
                                        <CalendarIcon size={14} />
                                        Due {formatDueDate(task.dueDate)}
                                        {overdue && ' · Overdue'}
                                    </span>
                                )}
                                <button className="btn btn-secondary details-edit" onClick={() => setIsEditing(true)}>Edit</button>
                            </div>

                            <h3 className="details-heading">Notes</h3>
                            {task.description
                                ? <p className="details-notes">{task.description}</p>
                                : <p className="details-empty">No notes yet. Use Edit to add some.</p>}
                        </section>
                    )}

                    <TaskLabels
                        task={task}
                        boardLabels={boardLabels}
                        onTaskChanged={onTaskChanged}
                        onSessionEnded={onSessionEnded}
                    />

                    <Checklist
                        taskId={task.id}
                        onProgress={(done, total) => onChecklistProgress(task.id, done, total)}
                        onSessionEnded={onSessionEnded}
                    />

                    <Attachments
                        taskId={task.id}
                        onSessionEnded={onSessionEnded}
                        onCountChange={(count) => onAttachmentCount(task.id, count)}
                    />
                   
                    <Comments taskId={task.id} currentUserId={currentUserId} onSessionEnded={onSessionEnded} />

                    {/* At the very bottom, away from everything else: deleting the whole task */}
                    <section className="details-section details-delete">
                        <button className="btn btn-danger" onClick={handleDelete}>
                            <TrashIcon />
                            Delete task
                        </button>
                    </section>
                </div>
            </div>
        </div>
    );
}

export default TaskDetails;
