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
import AiTab from './AiTab';
import { AI_STATES, aiStateOf, hasAiWork } from '../aiState';

// The panel that opens when you click a task: details + notes (editable), checklist, comments.
// Tasks Claude works on also get an AI tab (AiTab), so everything about Claude stays apart from the rest.
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
//   boardProject                             -> the board's Claude project (null = Claude skips this board)
//   agentTaskId                              -> the task the runner is working on right now
//   initialTab                               -> 'details' or 'ai' (e.g. when opened from a notification)
//   onAiChanged()                            -> App refreshes the bell and the runner's status
function TaskDetails({
    task, currentUserId, onSave, onChecklistProgress, onSessionEnded, onClose,
    boardLabels = [], onTaskChanged, onAttachmentCount = () => {},
    onStatusChange = () => {}, onDelete = () => {}, boardProject = null,
    agentTaskId = null, initialTab = 'details', onAiChanged = () => {},
})
{
    const [isEditing, setIsEditing] = useState(false);
    const showAi = hasAiWork(task);
    const [tab, setTab] = useState(showAi ? initialTab : 'details');

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

    // The AI tab gets a dot when the task needs you: a prompt to approve, a build to review, or a failure
    const aiState = aiStateOf(task);
    const needsYou = ['approval', 'review', 'failed'].includes(aiState);

    // Tabs, the usual way: Left and Right move between them
    const handleTabKeys = (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const next = tab === 'details' ? 'ai' : 'details';
        setTab(next);
        document.getElementById(`task-tab-${next}-${task.id}`)?.focus();
    };
    const tabButton = (value, label) => (
        <button
            type="button"
            role="tab"
            id={`task-tab-${value}-${task.id}`}
            className={tab === value ? 'details-tab active' : 'details-tab'}
            aria-selected={tab === value}
            aria-label={value === 'ai' && needsYou ? `AI (${AI_STATES[aiState].label})` : undefined}
            aria-controls={`task-panel-${task.id}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
        >
            {label}
            {value === 'ai' && needsYou && (
                <span className={`dot dot-${AI_STATES[aiState].tone}`} aria-hidden="true" />
            )}
        </button>
    );

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

                {showAi && (
                    <div className="details-tabs" role="tablist" aria-label="Task" onKeyDown={handleTabKeys}>
                        {tabButton('details', 'Details')}
                        {tabButton('ai', 'AI')}
                    </div>
                )}

                <div
                    className="modal-body task-details-body"
                    id={`task-panel-${task.id}`}
                    role={showAi ? 'tabpanel' : undefined}
                    aria-labelledby={showAi ? `task-tab-${tab}-${task.id}` : undefined}
                >
                    {tab === 'ai' ? (
                        <AiTab
                            task={task}
                            boardProject={boardProject}
                            agentTaskId={agentTaskId}
                            onTaskChanged={onTaskChanged}
                            onAiChanged={onAiChanged}
                            onSessionEnded={onSessionEnded}
                        />
                    ) : (<>
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
                    </>)}
                </div>
            </div>
        </div>
    );
}

export default TaskDetails;
