import { useState } from 'react';
import { approvePrompt, requestPromptChanges, retryAiTask, updateRefinedPrompt } from '../api';
import { formatDateTime } from '../dates';
import AiRunLog from './AiRunLog';

// Tasks with a label called "AI" (any capitals) are the ones the Claude runner works on
const isAiTask = (task) => task.labels?.some((l) => l.name.toLowerCase() === 'ai');

// The blanks Claude leaves for you, e.g. "[[FILL IN: which page should this go on?]]"
const hasBlanks = (text) => /\[\[\s*FILL IN/i.test(text ?? '');

// The "Claude" part of the task panel: where the task is in the runner's workflow, and your part in it.
//   To do          -> Claude writes a prompt on its next run
//   Prompt Review  -> you read the prompt, edit it, then Approve or Request changes
//   In progress    -> Claude builds the approved prompt on its next run
//   AI Review      -> built on a branch; Claude's summary is in the comments
// Hidden on tasks Claude has nothing to do with.
//   boardProject: the board's project name (null = the runner skips this board)
//   onTaskChanged(updatedTask): App updates the task (and moves the card when it changes column)
//   onCommentsChanged(): the panel reloads the comments (after "Request changes" adds yours)
function AiSection({ task, boardProject = null, onTaskChanged, onCommentsChanged = () => {}, onSessionEnded })
{
    const [draft, setDraft] = useState(task.refinedPrompt ?? '');
    const [changeRequest, setChangeRequest] = useState(null); // null = closed, else the comment being written
    const [error, setError] = useState(null);
    const [isBusy, setIsBusy] = useState(false);

    if (!isAiTask(task) && !task.refinedPrompt && !task.aiBranch) return null;

    // Every button: call the server, then hand the updated task to App. Returns it, or null if it failed.
    const run = async (action) => {
        setError(null);
        setIsBusy(true);
        try
        {
            const updated = await action();
            onTaskChanged(updated);
            return updated;
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message);
            return null;
        }
        finally
        {
            setIsBusy(false);
        }
    };

    const isDirty = draft.trim() !== (task.refinedPrompt ?? '').trim();
    const save = () => run(() => updateRefinedPrompt(task.id, draft));

    // Approves exactly what's in the box: unsaved edits are saved first
    const approve = async (e) => {
        e.preventDefault();
        if (isDirty && !(await save())) return;
        await run(() => approvePrompt(task.id));
    };

    const sendChangeRequest = async (e) => {
        e.preventDefault();
        if (await run(() => requestPromptChanges(task.id, changeRequest.trim())))
        {
            setChangeRequest(null);
            onCommentsChanged();
        }
    };

    const branch = task.aiBranch && <code className="ai-code">{task.aiBranch}</code>;
    let body = null;

    if (task.status === 'PROMPT_REVIEW' && task.refinedPrompt && task.changesRequested)
    {
        body = (
            <>
                <p className="ai-state">Revising… Claude will update the prompt using your comments on its next run.</p>
                <pre className="ai-prompt">{task.refinedPrompt}</pre>
            </>
        );
    }
    else if (task.status === 'PROMPT_REVIEW' && task.refinedPrompt)
    {
        body = (
            <>
                <form className="ai-review" onSubmit={approve}>
                    <div className="field">
                        <label htmlFor={`ai-prompt-${task.id}`}>Claude&apos;s prompt</label>
                        <textarea
                            id={`ai-prompt-${task.id}`}
                            className="ai-prompt-input"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            maxLength={20000}
                            rows={14}
                        />
                        <p className="profile-hint">
                            {hasBlanks(draft)
                                ? 'Fill in the [[FILL IN: …]] blanks, then approve.'
                                : 'Approving locks in this exact text: it is what Claude builds.'}
                        </p>
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={save} disabled={!isDirty || isBusy}>
                            Save edits
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setChangeRequest('')} disabled={isBusy}>
                            Request changes
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={isBusy || hasBlanks(draft)}>
                            Approve prompt
                        </button>
                    </div>
                </form>

                {changeRequest !== null && (
                    <form className="comment-form" onSubmit={sendChangeRequest}>
                        <textarea
                            value={changeRequest}
                            onChange={(e) => setChangeRequest(e.target.value)}
                            maxLength={2000}
                            rows={3}
                            placeholder="What should Claude change in the prompt?"
                            aria-label="What should Claude change?"
                        />
                        <div className="comment-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setChangeRequest(null)}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={isBusy || !changeRequest.trim()}>
                                Send to Claude
                            </button>
                        </div>
                    </form>
                )}
            </>
        );
    }
    else if (task.status === 'TODO' && !task.refinedPrompt)
    {
        body = <p className="ai-state">Claude will write a prompt for this task on its next run.</p>;
    }
    else if (task.status === 'IN_PROGRESS' && task.aiBranch)
    {
        body = <p className="ai-state">Claude is building it on branch {branch}…</p>;
    }
    else if (task.status === 'IN_PROGRESS' && task.promptApprovedAt)
    {
        body = (
            <>
                <p className="ai-state">
                    Approved {formatDateTime(task.promptApprovedAt)}. Claude will build it on its next run.
                </p>
                <pre className="ai-prompt">{task.refinedPrompt}</pre>
            </>
        );
    }
    else if (task.aiBranch)
    {
        body = (
            <p className="ai-state">
                Built on branch {branch}. Claude&apos;s summary is in the comments below. To try it, switch the
                project to that branch: <code className="ai-code">git switch {task.aiBranch}</code>
            </p>
        );
    }
    else if (task.refinedPrompt)
    {
        body = <pre className="ai-prompt">{task.refinedPrompt}</pre>;
    }

    return(
        <section className="details-section ai-section" aria-label="Claude">
            <h3 className="details-heading">Claude</h3>
            {error && <p className="error-message">{error}</p>}
            {task.aiError && (
                <div className="ai-stopped">
                    <p className="error-message">Claude stopped: {task.aiError}</p>
                    <button className="btn btn-secondary" onClick={() => run(() => retryAiTask(task.id))} disabled={isBusy}>
                        Try again
                    </button>
                </div>
            )}
            {!boardProject && (
                <p className="profile-hint">
                    Claude only picks up AI tasks on boards with a project. Set one in Board settings.
                </p>
            )}
            {body}
            <AiRunLog taskId={task.id} onSessionEnded={onSessionEnded} />
        </section>
    );
}

export default AiSection;
