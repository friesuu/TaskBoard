import { useEffect } from 'react';
import { CloseIcon } from './Icons';

export const MAX_TOASTS = 3; // on screen at once; the others wait their turn
export const TOAST_MS = 5000; // how long a success or info toast stays

// One toast. Anything but a failure goes away by itself; a failure stays until you close it.
function Toast({ toast, onDismiss, onView })
{
    useEffect(() => {
        if (toast.tone === 'danger') return;
        const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
        return () => clearTimeout(timer);
    }, [toast, onDismiss]);

    return(
        <div className={toast.tone === 'danger' ? 'toast danger' : 'toast'}>
            <span className={`dot dot-${toast.tone}`} aria-hidden="true" />
            <p className="toast-text">{toast.text}</p>
            {toast.task && <button type="button" className="text-btn" onClick={() => onView(toast)}>View</button>}
            <button type="button" className="icon-btn toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
                <CloseIcon size={16} />
            </button>
        </div>
    );
}

// The toasts in the bottom right corner, for the runner's notifications (a prompt to approve, a task to
// review, a failed run, the usage limit). Newest at the bottom, at most 3 at once. Screen readers hear each
// new one (aria-live), and none of them ever takes the keyboard focus.
//   toasts: [{ id, tone, text, task }]; onDismiss(id); onView(toast): App opens its task
function Toasts({ toasts, onDismiss, onView })
{
    return(
        <div className="toasts" aria-live="polite">
            {toasts.slice(0, MAX_TOASTS).map((t) => (
                <Toast key={t.id} toast={t} onDismiss={onDismiss} onView={onView} />
            ))}
        </div>
    );
}

export default Toasts;
