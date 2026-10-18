import { useEffect, useState } from 'react';
import TaskEditForm from './TaskEditForm';
import Checklist from './Checklist';
import Comments from './Comments';
import TaskLabels from './TaskLabels';
import { STATUSES } from '../statuses';
import { isOverdue } from '../dates';
import { CalendarIcon, CloseIcon } from './Icons';
import Attachments from './Attachments';

// The panel that opens when you click a task: details + notes (editable), checklist, comments.
// App decides WHICH task is open and passes it in; everything here works on that one task.
//   onSave(taskId, changes)                 -> App's handleEdit (saves title / notes / due date)
//   onChecklistProgress(taskId, done, total) -> App updates the "2/5" on the card
//   onSessionEnded(err)                      -> App's endedSession (expired login -> login screen)
//   onClose()                                -> App closes the panel
//   boardLabels                              -> the board's labels, to choose from
//   onTaskChanged(updatedTask)               -> App puts the task's new labels on its card
//   onAttachmentCount(taskId, count)         -> App updates the 📎 count on the card
function TaskDetails({
    task, currentUserId, onSave, onChecklistProgress, onSessionEnded, onClose,
    boardLabels = [], onTaskChanged, onAttachmentCount = () => {},
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

    const status = STATUSES.find((s) => s.value === task.status);

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
                                <span className="pill">
                                    <span className={`dot dot-${status?.tone ?? 'neutral'}`} aria-hidden="true" />
                                    {status?.label}
                                </span>
                                {task.dueDate && <span className="details-due"><CalendarIcon size={14} />Due {task.dueDate}</span>}
                                {isOverdue(task) && (
                                    <span className="pill">
                                        <span className="dot dot-danger" aria-hidden="true" />
                                        Overdue
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
                </div>
            </div>
        </div>
    );
}

export default TaskDetails;
