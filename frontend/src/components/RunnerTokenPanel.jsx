import { useEffect, useState } from 'react';
import { createRunnerToken, getRunnerToken, revokeRunnerToken } from '../api';
import { formatDateTime } from '../dates';

// "Runner token" on the profile: the key the Claude runner uses to reach your task board.
// It only works for the runner's own operations (read AI tasks, save prompts, report results).
// A new token is shown ONCE; only its hash is stored, so it can't be shown again.
function RunnerTokenPanel({ onSessionEnded })
{
    const [info, setInfo] = useState(undefined); // undefined = loading, null = no token yet
    const [newToken, setNewToken] = useState(null); // shown once, straight after creating it
    const [error, setError] = useState(null);
    const [isBusy, setIsBusy] = useState(false);

    useEffect(() => {
        let isStale = false;
        getRunnerToken()
            .then((loaded) => { if (!isStale) setInfo(loaded); })
            .catch((err) => { if (!onSessionEnded(err)) setError(err.message); });
        return () => { isStale = true; };
    }, [onSessionEnded]);

    const act = async (action) => {
        setError(null);
        setIsBusy(true);
        try
        {
            await action();
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message);
        }
        finally
        {
            setIsBusy(false);
        }
    };

    const handleCreate = () => {
        if (info && !window.confirm('Create a new token? The old one stops working straight away.')) return;
        act(async () => {
            setNewToken(await createRunnerToken());
            setInfo(await getRunnerToken());
        });
    };

    const handleRevoke = () => {
        if (!window.confirm('Revoke the runner token? The runner stops working until you create a new one.')) return;
        act(async () => {
            await revokeRunnerToken();
            setInfo(null);
            setNewToken(null);
        });
    };

    return(
        <div className="settings-form">
            <p className="profile-hint">
                The Claude runner uses this to read and update your AI tasks. It can&apos;t do anything else with it.
            </p>
            {error && <p className="error-message">{error}</p>}

            {newToken && (
                <div className="runner-token-new">
                    <p className="success-message">
                        Put this in RUNNER_TOKEN in ~/task-board/runner/.env now. It won&apos;t be shown again.
                    </p>
                    <code className="ai-code runner-token-value">{newToken}</code>
                </div>
            )}

            {info === undefined && !error && <p className="details-empty">Loading…</p>}
            {info === null && <p className="details-empty">No token yet.</p>}
            {info && (
                <p className="profile-hint">
                    Created {formatDateTime(info.createdAt)} · {info.lastUsedAt
                        ? `last used ${formatDateTime(info.lastUsedAt)}`
                        : 'not used yet'}
                </p>
            )}

            {info !== undefined && (
                <div className="form-actions">
                    {info && (
                        <button className="btn btn-danger" onClick={handleRevoke} disabled={isBusy}>Revoke token</button>
                    )}
                    <button className="btn btn-primary" onClick={handleCreate} disabled={isBusy}>
                        {info ? 'Create a new token' : 'Create token'}
                    </button>
                </div>
            )}
        </div>
    );
}

export default RunnerTokenPanel;
