import { useState } from 'react';
import { setTaskLabels } from '../api';
import { labelColorClass } from '../labelColors';
import LabelPill from './LabelPill';

const MAX_LABELS = 10; // the server allows at most 10 labels on a task

// The "Labels" part of the task panel: the task's labels, and (after "Edit labels")
// a tick list of the board's labels. Each tick saves straight away.
// onTaskChanged(updatedTask) lets App put the new labels on the card too.
function TaskLabels({ task, boardLabels, onTaskChanged, onSessionEnded })
{
    const [isPicking, setIsPicking] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    const labels = task.labels ?? [];
    const selectedIds = labels.map((l) => l.id);

    const toggle = async (labelId) => {
        const next = selectedIds.includes(labelId)
            ? selectedIds.filter((id) => id !== labelId)
            : [...selectedIds, labelId];

        setError(null);
        setIsSaving(true);
        try
        {
            onTaskChanged(await setTaskLabels(task.id, next));
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

    return(
        <section className="details-section" aria-label="Labels">
            <div className="details-section-header">
                <h3 className="details-heading">Labels</h3>
                <button className="btn btn-ghost details-edit" onClick={() => setIsPicking(!isPicking)} aria-expanded={isPicking}>
                    {isPicking ? 'Done' : 'Edit labels'}
                </button>
            </div>

            {error && <p className="error-message">{error}</p>}

            {labels.length > 0 && (
                <div className="label-pills">
                    {labels.map((l) => <LabelPill key={l.id} label={l} />)}
                </div>
            )}
            {labels.length === 0 && !isPicking && <p className="details-empty">No labels.</p>}

            {isPicking && (boardLabels.length === 0 ? (
                <p className="details-empty">This board has no labels yet. Add them in Board settings.</p>
            ) : (
                <ul className="list label-picker">
                    {boardLabels.map((l) => {
                        const checked = selectedIds.includes(l.id);
                        return(
                            <li key={l.id} className="checklist-item">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={isSaving || (!checked && selectedIds.length >= MAX_LABELS)}
                                        onChange={() => toggle(l.id)}
                                    />
                                    <span className={`dot label-dot ${labelColorClass(l.color)}`} aria-hidden="true" />
                                    <span>{l.name}</span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            ))}
        </section>
    );
}

export default TaskLabels;
