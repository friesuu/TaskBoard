import { useEffect, useRef, useState } from 'react';
import { approvePrompt, getAgentRuns, getAiNotes, requestPromptChanges, retryAiTask, updateRefinedPrompt } from '../api';
import { formatDateTime } from '../dates';
import { AI_STEPS, STEP_NAMES, aiStateOf, aiStepOf, durationOf, runResultText } from '../aiState';
import AiChip from './AiChip';
import PromptView from './PromptView';
import RunLog from './RunLog';

// The blanks Claude leaves for you, e.g. "[[FILL IN: which page should this go on?]]"
const BLANK = /\[\[\s*FILL IN[^\]]*\]\]/gi;
const blanksIn = (text) => [...(text ?? '').matchAll(BLANK)];

// The task panel's AI tab: everything about Claude and this task, kept apart from the rest of the task.
//   - where it is (the chip, and Refine → Approve → Work → Review)
//   - the prompt, formatted to read. In Prompt Review: Edit it (fill in its blanks), then Approve it, or
//     Reject it with feedback for Claude. Only the buttons for what you're doing are shown.
//   - the last build's summary: what changed, files, branch, how to try it
//   - your feedback and Claude's older notes, and the step-by-step logs (both folded away)
//   boardProject: the board's project name (null = the runner skips this board)
//   agentTaskId: the task the runner is working on right now (its chip's dot pulses)
//   onTaskChanged(updatedTask): App updates the task (and moves the card when it changes column)
//   onAiChanged(): App refreshes the bell and the runner's status after you act
function AiTab({ task, boardProject = null, agentTaskId = null, onTaskChanged, onAiChanged = () => {}, onSessionEnded })
{
    const [draft, setDraft] = useState(task.refinedPrompt ?? '');
    const [isEditing, setIsEditing] = useState(false);
    const [feedback, setFeedback] = useState(null); // null = closed, else the feedback being written
    const [error, setError] = useState(null);
    const [isBusy, setIsBusy] = useState(false);
    const [runs, setRuns] = useState(null); // null = loading
    const [notes, setNotes] = useState([]);
    const [openRunId, setOpenRunId] = useState(null);
    const promptBox = useRef(null);
    const blankToSelect = useRef(null); // a blank to select once the edit box opens

    // The runs and notes: loaded when the tab opens, and again when the task moves on
    useEffect(() => {
        let isStale = false;
        Promise.all([getAgentRuns(task.id), getAiNotes(task.id)])
            .then(([runList, noteList]) => {
                if (isStale) return;
                setRuns(runList);
                setNotes(noteList);
            })
            .catch((err) => { if (!isStale && !onSessionEnded(err)) setError(err.message); });
        return () => { isStale = true; };
    }, [task.id, task.status, task.changesRequested, task.aiBranch, onSessionEnded]);

    // Every button: call the server, then hand the updated task to App. Returns it, or null if it failed.
    const act = async (action) => {
        setError(null);
        setIsBusy(true);
        try
        {
            const updated = await action();
            onTaskChanged(updated);
            onAiChanged();
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

    const save = async (e) => {
        e.preventDefault();
        if (await act(() => updateRefinedPrompt(task.id, draft))) setIsEditing(false);
    };

    const cancelEdit = () => {
        setDraft(task.refinedPrompt ?? '');
        setIsEditing(false);
    };

    const approve = () => act(() => approvePrompt(task.id));

    // Reject: Claude rewrites the prompt with your feedback on its next run
    const reject = async (e) => {
        e.preventDefault();
        if (await act(() => requestPromptChanges(task.id, feedback.trim()))) setFeedback(null);
    };

    // Blanks: the saved prompt's decide whether you can approve; the draft's are the ones you're filling in
    const savedBlanks = blanksIn(task.refinedPrompt);
    const blanks = blanksIn(draft);

    // Selects the nth blank in the edit box, so typing replaces it. focus() after blur() scrolls to it.
    const selectBlank = (n) => {
        const box = promptBox.current;
        const match = blanksIn(box.value)[n];
        if (!match) return;
        box.blur();
        box.setSelectionRange(match.index, match.index + match[0].length);
        box.focus();
    };

    // Edit opens the box with the cursor in it; clicking a blank in the formatted prompt opens it on that blank
    const startEditing = (blank = null) => {
        blankToSelect.current = blank;
        setFeedback(null);
        setIsEditing(true);
    };
    useEffect(() => {
        if (!isEditing) return;
        if (blankToSelect.current === null) promptBox.current.focus();
        else selectBlank(blankToSelect.current);
        blankToSelect.current = null;
    }, [isEditing]); // only when the box opens

    // The next blank after the cursor, wrapping round to the first
    const goToNextBlank = () => {
        const end = promptBox.current.selectionEnd;
        const next = blanks.findIndex((m) => m.index >= end);
        selectBlank(next === -1 ? 0 : next);
    };

    const state = aiStateOf(task);
    const step = aiStepOf(task);
    const branch = task.aiBranch && <code className="ai-code">{task.aiBranch}</code>;
    const lastBuild = runs?.find((r) => r.step === 'build' && r.status !== 'running' && r.summary);
    const isReviewing = task.status === 'PROMPT_REVIEW' && task.refinedPrompt && !task.changesRequested;

    // What's happening, in a sentence
    let stateText = null;
    if (task.status === 'TODO' && !task.refinedPrompt) stateText = 'Claude will write a prompt for this task on its next run.';
    else if (task.status === 'PROMPT_REVIEW' && task.changesRequested) stateText = 'Claude is rewriting the prompt with your feedback.';
    else if (task.status === 'IN_PROGRESS' && task.aiBuiltAt)
    {
        stateText = (
            <>
                Claude will build it again on its next run, from scratch on a new branch. The last build is on
                branch {branch}. To change the prompt first, move the task to Prompt Review.
            </>
        );
    }
    else if (task.status === 'IN_PROGRESS' && task.aiBranch) stateText = <>Claude is building it on branch {branch}…</>;
    else if (task.status === 'IN_PROGRESS' && task.promptApprovedAt)
    {
        stateText = `Approved ${formatDateTime(task.promptApprovedAt)}. Claude will build it on its next run.`;
    }
    else if (task.aiBranch) stateText = <>Built on branch {branch}.</>;

    return(
        <div className="ai-tab">
            <div className="ai-tab-status">
                <AiChip state={state} active={agentTaskId === task.id} />
                <ol className="ai-steps" aria-label="Progress">
                    {AI_STEPS.map((name, i) => (
                        <li
                            key={name}
                            className={i < step ? 'ai-step done' : i === step ? 'ai-step current' : 'ai-step'}
                            aria-current={i === step ? 'step' : undefined}
                        >
                            <span className="ai-step-mark" aria-hidden="true" />
                            {name}
                            {i < step && <span className="sr-only"> (done)</span>}
                        </li>
                    ))}
                </ol>
            </div>

            {stateText && <p className="ai-state">{stateText}</p>}
            {!boardProject && (
                <p className="profile-hint">
                    Claude only picks up AI tasks on boards with a project. Set one in Board settings.
                </p>
            )}
            {error && <p className="error-message">{error}</p>}
            {task.aiError && (
                <div className="ai-stopped">
                    <p className="error-message">Claude stopped: {task.aiError}</p>
                    <button className="btn btn-secondary" onClick={() => act(() => retryAiTask(task.id))} disabled={isBusy}>
                        Try again
                    </button>
                </div>
            )}

            {isReviewing && !isEditing && (
                <section className="ai-section">
                    <div className="ai-section-header">
                        <h3 className="ai-section-title">Claude&apos;s prompt</h3>
                        <button type="button" className="text-btn" onClick={() => startEditing()}>
                            Edit
                        </button>
                    </div>
                    {savedBlanks.length > 0 && (
                        <p className="ai-notice">
                            {savedBlanks.length === 1 ? '1 blank' : `${savedBlanks.length} blanks`} to fill in before you can approve.{' '}
                            <button type="button" className="text-btn" onClick={() => startEditing(0)}>Fill in</button>
                        </p>
                    )}
                    <div className="ai-prompt-box">
                        <PromptView text={task.refinedPrompt} onBlankClick={startEditing} />
                    </div>

                    {feedback === null
                        ? (
                            <div className="ai-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setFeedback('')} disabled={isBusy}>
                                    Reject…
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={approve}
                                    disabled={isBusy || savedBlanks.length > 0}
                                    title="Locks in this exact text: it is what Claude builds"
                                >
                                    Approve prompt
                                </button>
                            </div>
                        )
                        : (
                            <form className="ai-feedback" onSubmit={reject}>
                                <textarea
                                    value={feedback}
                                    onChange={(e) => setFeedback(e.target.value)}
                                    maxLength={2000}
                                    rows={3}
                                    placeholder="What should Claude change in the prompt?"
                                    aria-label="What should Claude change?"
                                    autoFocus
                                />
                                <div className="ai-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => setFeedback(null)}>Cancel</button>
                                    <button type="submit" className="btn btn-primary" disabled={isBusy || !feedback.trim()}>
                                        Send to Claude
                                    </button>
                                </div>
                            </form>
                        )}
                </section>
            )}

            {isReviewing && isEditing && (
                <form className="ai-section" onSubmit={save}>
                    <div className="ai-section-header">
                        <label htmlFor={`ai-prompt-${task.id}`} className="ai-section-title">Claude&apos;s prompt</label>
                        {blanks.length > 0 && (
                            <button type="button" className="text-btn" onClick={goToNextBlank}>
                                Next blank ({blanks.length} left)
                            </button>
                        )}
                    </div>
                    <textarea
                        id={`ai-prompt-${task.id}`}
                        ref={promptBox}
                        className="ai-prompt-input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={20000}
                        rows={16}
                    />
                    <div className="ai-actions">
                        <button type="button" className="btn btn-secondary" onClick={cancelEdit} disabled={isBusy}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={isBusy || !isDirty}>Save</button>
                    </div>
                </form>
            )}

            {lastBuild && (
                <section className="ai-section ai-last-run" aria-label="Last run">
                    <div className="ai-section-header">
                        <h3 className="ai-section-title">Last build</h3>
                        <span className="ai-run-line">
                            {STEP_NAMES[lastBuild.step]} · {runResultText(lastBuild)} · {durationOf(lastBuild)}
                        </span>
                    </div>
                    <pre className="ai-summary">{lastBuild.summary}</pre>
                </section>
            )}

            {/* Everything else, folded away */}
            <section className="ai-section">
                <h3 className="ai-section-title">History</h3>
                {!isReviewing && task.refinedPrompt && (
                    <details className="ai-fold">
                        <summary>Prompt</summary>
                        <PromptView text={task.refinedPrompt} />
                    </details>
                )}
                {notes.length > 0 && (
                    <details className="ai-fold">
                        <summary>Your feedback and Claude&apos;s notes ({notes.length})</summary>
                        <ol className="ai-notes">
                            {notes.map((n) => (
                                <li key={n.id} className="ai-note">
                                    <span className="ai-note-who">
                                        {n.kind === 'feedback' ? 'Your feedback' : 'Claude'} · {formatDateTime(n.createdAt)}
                                    </span>
                                    <p className="ai-note-body">{n.body}</p>
                                </li>
                            ))}
                        </ol>
                    </details>
                )}

                <details className="ai-fold">
                    <summary>Logs{runs ? ` (${runs.length} ${runs.length === 1 ? 'run' : 'runs'})` : ''}</summary>
                    {runs === null && !error && <p className="details-empty">Loading…</p>}
                    {runs?.length === 0 && <p className="details-empty">No runs yet.</p>}
                    {runs?.length > 0 && (
                        <ol className="ai-runs">
                            {runs.map((run) => {
                                const isOpen = openRunId === run.id;
                                return(
                                    <li key={run.id} className="ai-run">
                                        <button
                                            type="button"
                                            className="ai-run-toggle"
                                            aria-expanded={isOpen}
                                            aria-label={`${STEP_NAMES[run.step] ?? run.step}, ${runResultText(run)}, `
                                                + `${formatDateTime(run.startedAt)}, ${durationOf(run)}`}
                                            onClick={() => setOpenRunId(isOpen ? null : run.id)}
                                        >
                                            <span className="ai-run-step">{STEP_NAMES[run.step] ?? run.step}</span>
                                            <span className={run.status === 'failed' ? 'ai-run-result bad' : 'ai-run-result'}>
                                                {runResultText(run)}
                                            </span>
                                            <span className="ai-run-meta">
                                                {formatDateTime(run.startedAt)} · {durationOf(run)}
                                                {run.costUsd !== null && ` · $${run.costUsd.toFixed(2)}`}
                                            </span>
                                        </button>
                                        {run.error && <p className="ai-run-error">{run.error}</p>}
                                        {isOpen && <RunLog runId={run.id} isRunning={run.status === 'running'} onSessionEnded={onSessionEnded} />}
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </details>
            </section>
        </div>
    );
}

export default AiTab;
