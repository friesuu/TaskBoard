import { useState } from "react";
import { CalendarIcon, ChecklistIcon, PaperclipIcon } from "./Icons";
import LabelPill from "./LabelPill";
import Checklist from "./Checklist";
import Attachments from "./Attachments";
import { formatDueDate, isOverdue } from "../dates";
import { STATUSES } from "../statuses";
import { Draggable } from "@hello-pangea/dnd";

// One card on the board: only what the task is and what needs attention.
// Clicking the card (or its title) opens the task panel, where it's edited, moved to another column or deleted.
// The checklist and files can also be opened right on the card (the ☑ and 📎 counts, shown when there are some).
//   dragDisabled: true while filters are on (a position among SOME of the column's cards isn't the real one)
//   onChecklistProgress(taskId, done, total) / onAttachmentCount(taskId, count): App updates the counts
//   onSessionEnded(err): an expired login goes back to the login screen
// What the Claude runner is doing with this task, as one short line on the card (null = nothing to say)
function aiStatusOf(task)
{
    if (task.aiError) return { text: 'Claude stopped', tone: 'danger' };
    if (task.changesRequested) return { text: 'Revising…', tone: 'prompt' };
    if (task.status === 'IN_PROGRESS' && task.aiBranch) return { text: 'Claude is building…', tone: 'ai' };
    if (task.status === 'IN_PROGRESS' && task.promptApprovedAt) return { text: 'Approved, waiting for Claude', tone: 'ai' };
    return null;
}

function TaskCard({
    index, task, onOpen, dragDisabled = false,
    onChecklistProgress = () => {}, onAttachmentCount = () => {}, onSessionEnded = () => false,
})
{
    const [openSection, setOpenSection] = useState(null); // 'checklist', 'files' or null (both folded away)
    const toggle = (name) => setOpenSection(openSection === name ? null : name);

    const overdue = isOverdue(task);
    // tone-* = the column's colour for the thin edge on the left (an overdue card shows its red bar instead)
    const tone = STATUSES.find((s) => s.value === task.status)?.tone ?? 'neutral';
    let className = `task-card tone-${tone}`;
    if (overdue) className += ' overdue';

    const done = task.checklistDone ?? 0;
    const total = task.checklistTotal ?? 0;
    const files = task.attachmentCount ?? 0;
    const aiStatus = aiStatusOf(task);
    const hasMeta = Boolean(task.dueDate) || total > 0 || files > 0 || aiStatus !== null;

    // A click on the card itself opens the task. Clicks on its own buttons, links and fields,
    // and anywhere inside an opened checklist or files list, do their own thing instead.
    const handleCardClick = (e) => {
        if (e.target.closest('button, a, input, label, textarea, select, form, .task-quick-panel')) return;
        onOpen(task.id);
    };

    // ☑ 2/5 or 📎 3: opens / folds that list on the card
    const quickToggle = (name, label, content, extraClass = '') => (
        <button
            className={`quick-toggle ${extraClass}`}
            aria-expanded={openSection === name}
            aria-label={label}
            onClick={() => toggle(name)}
        >
            {content}
        </button>
    );

    return(
        <Draggable draggableId={String(task.id)} index={index} isDragDisabled={dragDisabled}>
            {(provided, snapshot) => (
            <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={snapshot.isDragging ? `${className} dragging` : className}
                onClick={handleCardClick}
            >
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

                {/* The notes in full, keeping their line breaks */}
                {task.description && <p className="task-notes">{task.description}</p>}

                {/* One quiet row with only what this task has: due date, checklist, files */}
                {hasMeta && (
                    <div className="task-meta">
                        {task.dueDate && (
                            <span className={overdue ? 'task-due overdue' : 'task-due'}>
                                <CalendarIcon size={14} />
                                {formatDueDate(task.dueDate)}
                                {overdue && ' · Overdue'}
                            </span>
                        )}
                        {total > 0 && quickToggle(
                            'checklist',
                            `Checklist, ${done} of ${total} done`,
                            <><ChecklistIcon size={14} />{done}/{total}</>,
                            done === total ? 'complete' : '',
                        )}
                        {files > 0 && quickToggle('files', `Files, ${files}`, <><PaperclipIcon size={14} />{files}</>)}
                        {aiStatus && (
                            <span className={aiStatus.tone === 'danger' ? 'task-ai-status danger' : 'task-ai-status'}>
                                <span className={`dot dot-${aiStatus.tone}`} aria-hidden="true" />
                                {aiStatus.text}
                            </span>
                        )}
                    </div>
                )}

                {/* The opened list: the same Checklist / Attachments as the panel, in their compact form */}
                {openSection === 'checklist' && total > 0 && (
                    <div className="task-quick-panel">
                        <Checklist
                            compact
                            taskId={task.id}
                            onProgress={(d, t) => onChecklistProgress(task.id, d, t)}
                            onSessionEnded={onSessionEnded}
                        />
                    </div>
                )}
                {openSection === 'files' && files > 0 && (
                    <div className="task-quick-panel">
                        <Attachments
                            compact
                            taskId={task.id}
                            onCountChange={(count) => onAttachmentCount(task.id, count)}
                            onSessionEnded={onSessionEnded}
                        />
                    </div>
                )}
            </div>
            )}

        </Draggable>
    );
}

export default TaskCard;
