import { useState } from "react";
import { STATUSES } from "../statuses";
import TrashIcon from "./TrashIcon";
import { CalendarIcon, ChecklistIcon, ChevronDownIcon, PaperclipIcon } from "./Icons";
import LabelPill from "./LabelPill";
import Checklist from "./Checklist";
import Attachments from "./Attachments";
import { isOverdue } from "../dates";
import { Draggable } from "@hello-pangea/dnd";

// One card on the board. Clicking the title (or Open) asks App to open the task details panel.
// The checklist and the files can also be opened right on the card (the ☑ and 📎 buttons):
// tick items and add one; attach, download or delete files. Everything else is edited in the panel.
//   dragDisabled: true while filters are on (a position among SOME of the column's cards isn't the real one)
//   onChecklistProgress(taskId, done, total) / onAttachmentCount(taskId, count): App updates the counts
//   onSessionEnded(err): an expired login goes back to the login screen
function TaskCard({
    index, task, onStatusChange, onDelete, onOpen, dragDisabled = false,
    onChecklistProgress = () => {}, onAttachmentCount = () => {}, onSessionEnded = () => false,
})
{
    const [openSection, setOpenSection] = useState(null); // 'checklist', 'files' or null (both folded away)
    const toggle = (name) => setOpenSection(openSection === name ? null : name);

    const overdue = isOverdue(task);
    let className = 'task-card';
    if (overdue) className += ' overdue';

    const done = task.checklistDone ?? 0;
    const total = task.checklistTotal ?? 0;
    const files = task.attachmentCount ?? 0;

    // A button that opens / folds one section on the card
    const quickToggle = (name, label, content, extraClass = '') => (
        <button
            className={`quick-toggle ${extraClass}`}
            aria-expanded={openSection === name}
            aria-label={label}
            onClick={() => toggle(name)}
        >
            {content}
            <ChevronDownIcon size={14} />
        </button>
    );

    return(
        <Draggable draggableId={String(task.id)} index={index} isDragDisabled={dragDisabled}>
            {(provided, snapshot) => (
            <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className={snapshot.isDragging ? `${className} dragging` : className}>
                <h3>
                    <button className="task-title-btn" onClick={() => onOpen(task.id)}>
                        {task.title}
                    </button>
                </h3>

                {task.labels?.length > 0 && (
                    <div className="label-pills">
                        {task.labels.map((l) => <LabelPill key={l.id} label={l} />)}
                    </div>
                )}

                {/* Notes preview: cut to 2 lines by CSS; the full text is in the details panel */}
                {task.description && <p className="task-notes">{task.description}</p>}
                {task.dueDate && (
                    <p className="task-due">
                        <CalendarIcon size={14} />
                        Due {task.dueDate}
                    </p>
                )}

                <div className="task-badges">
                    {/* Pill: the coloured dot adds meaning, the text carries it */}
                    {overdue && (
                        <span className="pill">
                            <span className="dot dot-danger" aria-hidden="true" />
                            Overdue
                        </span>
                    )}
                    {quickToggle(
                        'checklist',
                        `Checklist, ${done} of ${total} done`,
                        <><ChecklistIcon size={14} />{done}/{total}</>,
                        total > 0 && done === total ? 'complete' : '',
                    )}
                    {quickToggle('files', `Files, ${files}`, <><PaperclipIcon size={14} />{files}</>)}
                </div>

                {/* The opened section: the same Checklist / Attachments as the panel, in their compact form */}
                {openSection === 'checklist' && (
                    <div className="task-quick-panel">
                        <Checklist
                            compact
                            taskId={task.id}
                            onProgress={(d, t) => onChecklistProgress(task.id, d, t)}
                            onSessionEnded={onSessionEnded}
                        />
                    </div>
                )}
                {openSection === 'files' && (
                    <div className="task-quick-panel">
                        <Attachments
                            compact
                            taskId={task.id}
                            onCountChange={(count) => onAttachmentCount(task.id, count)}
                            onSessionEnded={onSessionEnded}
                        />
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

                    <button className="btn btn-secondary" onClick={() => onOpen(task.id)}>
                        Open
                    </button>

                    {/* Icon only, so aria-label gives screen readers a name; title shows on hover */}
                    <button
                        className="icon-btn icon-btn-danger task-delete"
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
