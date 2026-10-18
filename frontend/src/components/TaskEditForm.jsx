import { useState } from 'react';

function TaskEditForm({ task, onSave, onCancel }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    try {
      await onSave({
        title,
        description: description || null,
        dueDate: dueDate || null,
      });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="task-form">
      {error && <div className="error-message">{error}</div>}

      <div className="field">
        <label htmlFor={`edit-title-${task.id}`}>Title *</label>
        <input
          id={`edit-title-${task.id}`}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={100}
        />
      </div>

      <div className="field">
        <label htmlFor={`edit-description-${task.id}`}>Notes</label>
        <textarea
          id={`edit-description-${task.id}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={10000}
          rows={6}
        />
      </div>

      <div className="field">
        <label htmlFor={`edit-due-date-${task.id}`}>Due Date</label>
        <input
          id={`edit-due-date-${task.id}`}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>

      {/* Actions bottom-right, the main one last */}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Save</button>
      </div>
    </form>
  );
}

export default TaskEditForm;