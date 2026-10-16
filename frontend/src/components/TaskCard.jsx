import { STATUSES } from "../statuses";
import TrashIcon from "./TrashIcon";
import { isOverdue } from "../dates";
import { Draggable } from "@hello-pangea/dnd";

// One card on the board. Clicking the title (or Open) asks App to open the task details panel,
// where the task is edited; the card itself only shows a summary.
function TaskCard({ index, task, onStatusChange, onDelete, onOpen })
{
    let className = 'task-card';
    if (isOverdue(task)) className += ' overdue';

    const hasChecklist = task.checklistTotal > 0;
    const checklistComplete = hasChecklist && task.checklistDone === task.checklistTotal;

    return(
        <Draggable draggableId={String(task.id)} index={index}>
            {(provided, snapshot) => (
            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className={snapshot.isDragging ? `${className} dragging` : className}>
                <h3>
                    <button className="task-title-btn" onClick={() => onOpen(task.id)}>
                        {task.title}
                    </button>
                </h3>

                {/* Notes preview: cut to 2 lines by CSS; the full text is in the details panel */}
                {task.description && <p className="task-notes">{task.description}</p>}
                {task.dueDate && <p>Due: {task.dueDate}</p>}

                {/* Only when there's a badge: an empty row would still add a gap */}
                {(isOverdue(task) || hasChecklist) && (
                    <div className="task-badges">
                        {isOverdue(task) && <span className="overdue-label">Overdue</span>}
                        {hasChecklist && (
                            <span
                                className={checklistComplete ? 'checklist-badge complete' : 'checklist-badge'}
                                aria-label={`Checklist: ${task.checklistDone} of ${task.checklistTotal} done`}
                            >
                                ☑ {task.checklistDone}/{task.checklistTotal}
                            </span>
                        )}
                    </div>
                )}

                <div className="task-actions">
                    <select value={task.status} onChange={(e) => onStatusChange(task.id, e.target.value)} aria-label="Column">
                        {STATUSES.map((c) => (
                            <option key={c.value} value={c.value}>
                                {c.label}
                            </option>
                        ))}
                    </select>

                    <button className="edit-button" onClick={() => onOpen(task.id)}>
                        Open
                    </button>

                    {/* Icon only, so aria-label gives screen readers a name; title shows on hover */}
                    <button
                        className="delete-button"
                        aria-label={`Delete "${task.title}"`}
                        title="Delete"
                        onClick={() => {
                            if(window.confirm(`Delete "${task.title}"?`)){
                                onDelete(task.id)
                            }
                        }}
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>
            )}

        </Draggable>
    );
}

export default TaskCard;
