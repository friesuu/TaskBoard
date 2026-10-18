import TaskCard from './TaskCard.jsx';
import { Droppable } from '@hello-pangea/dnd';
import { STATUSES } from '../statuses';

function Column({status, title, tasks, onStatusChange, onDelete, onOpen})
{
    const tone = STATUSES.find((s) => s.value === status)?.tone ?? 'neutral'; // the column's status colour

    return(
        <Droppable droppableId={status}>
            {(provided, snapshot) => (
                <section className={`column column-${tone}${snapshot.isDraggingOver ? ' drag-over' : ''}`}>
                    <h2 className="column-header">
                        <span className={`dot dot-${tone}`} aria-hidden="true" />
                        {title}
                    </h2>

                    {/* The drop area is this list, NOT the whole column. In an empty column the library
                        aims a dropped card at the top of the drop area; if the title were inside it,
                        the card would fly onto the title before jumping into place. */}
                    <div className="task-list" ref={provided.innerRef} {...provided.droppableProps}>
                        {/* Hidden while a card hovers, so the card lands where the message was */}
                        {tasks.length === 0 && !snapshot.isDraggingOver && (
                            <p className="empty-message">No tasks</p>
                        )}

                        {tasks.map((task, index) => (
                            <TaskCard key={task.id} task={task} index={index} onStatusChange={onStatusChange} onDelete={onDelete} onOpen={onOpen}/>
                        ))}

                        {provided.placeholder}
                    </div>
                </section>
            )}
        </Droppable>
    );
}

export default Column;
