import { useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { STATUSES } from '../statuses';
import { isOverdue, todayString } from '../dates';
import { currentMonth, dueDateFromDrop, monthGrid, monthLabel, NO_DATE, shiftMonth, weekdayLabels } from '../calendar';
import { ArrowLeftIcon, ArrowRightIcon } from './Icons';

// The board's tasks on a month grid, by due date. Tasks without a due date are listed beside it.
// Drag a task to another day to change its due date (or onto "No due date" to clear it).
// Like the board, it shows App's (filtered) tasks and loads nothing itself:
//   onOpen(taskId)                  -> App opens the task panel
//   onDueDateChange(taskId, date)   -> App saves the new due date ('YYYY-MM-DD', or null for none)
function CalendarView({ tasks, onOpen, onDueDateChange })
{
    const [shown, setShown] = useState(currentMonth); // the month on screen
    const today = todayString();

    // The tasks of each day, e.g. { '2026-10-18': [task, task] }
    const tasksByDate = {};
    for (const task of tasks)
    {
        if (task.dueDate) (tasksByDate[task.dueDate] ??= []).push(task);
    }
    const undated = tasks.filter((t) => !t.dueDate);

    const handleDragEnd = (result) => {
        const change = dueDateFromDrop(result, tasks);
        if (change) onDueDateChange(change.taskId, change.dueDate);
    };

    return(
        <DragDropContext onDragEnd={handleDragEnd}>
            <div className="calendar">
                <div className="calendar-main">
                    {/* Month name, and the buttons to move between months */}
                    <div className="calendar-header">
                        <h2 className="calendar-month">{monthLabel(shown)}</h2>
                        <div className="calendar-nav">
                            <button className="btn btn-secondary" onClick={() => setShown(currentMonth())}>Today</button>
                            <button className="icon-btn" onClick={() => setShown(shiftMonth(shown, -1))} aria-label="Previous month">
                                <ArrowLeftIcon />
                            </button>
                            <button className="icon-btn" onClick={() => setShown(shiftMonth(shown, 1))} aria-label="Next month">
                                <ArrowRightIcon />
                            </button>
                        </div>
                    </div>

                    <div className="calendar-weekdays" aria-hidden="true">
                        {weekdayLabels().map((name) => <div key={name}>{name}</div>)}
                    </div>

                    <div className="calendar-grid">
                        {monthGrid(shown).flat().map(({ date, day, inMonth }) => (
                            <Droppable key={date} droppableId={date}>
                                {(provided, snapshot) => {
                                    let className = 'calendar-day';
                                    if (!inMonth) className += ' outside';
                                    if (date === today) className += ' today';
                                    if (snapshot.isDraggingOver) className += ' drag-over';
                                    return(
                                        <div ref={provided.innerRef} {...provided.droppableProps} className={className}>
                                            {/* The date in full for screen readers, just the number on screen */}
                                            <span className="calendar-date" aria-label={date}>{day}</span>
                                            {(tasksByDate[date] ?? []).map((task, index) => (
                                                <CalendarTask key={task.id} task={task} index={index} onOpen={onOpen} />
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    );
                                }}
                            </Droppable>
                        ))}
                    </div>
                </div>

                {/* Tasks with no due date: drag one onto a day to give it a date */}
                <Droppable droppableId={NO_DATE}>
                    {(provided, snapshot) => (
                        <section
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={snapshot.isDraggingOver ? 'calendar-undated drag-over' : 'calendar-undated'}
                            aria-label="No due date"
                        >
                            <h3>No due date</h3>
                            {undated.length === 0 && !snapshot.isDraggingOver && (
                                <p className="details-empty">Every task has a date.</p>
                            )}
                            {undated.map((task, index) => (
                                <CalendarTask key={task.id} task={task} index={index} onOpen={onOpen} />
                            ))}
                            {provided.placeholder}
                        </section>
                    )}
                </Droppable>
            </div>
        </DragDropContext>
    );
}

// One task on the calendar: its status dot and title. Click (or Enter) opens it; drag it to change its date.
// disableInteractiveElementBlocking: the whole chip is a button, and it can still be dragged.
function CalendarTask({ task, index, onOpen })
{
    const tone = STATUSES.find((s) => s.value === task.status)?.tone ?? 'neutral';
    let className = 'calendar-task';
    if (isOverdue(task)) className += ' overdue';
    if (task.status === 'DONE') className += ' done';

    return(
        <Draggable draggableId={String(task.id)} index={index} disableInteractiveElementBlocking>
            {(provided, snapshot) => (
                <button
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={snapshot.isDragging ? `${className} dragging` : className}
                    onClick={() => onOpen(task.id)}
                    title={task.title}
                >
                    <span className={`dot dot-${isOverdue(task) ? 'danger' : tone}`} aria-hidden="true" />
                    <span className="calendar-task-title">{task.title}</span>
                </button>
            )}
        </Draggable>
    );
}

export default CalendarView;
