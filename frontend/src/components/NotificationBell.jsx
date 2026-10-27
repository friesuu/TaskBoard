import { useEffect, useRef, useState } from 'react';
import { NOTIFICATION_TONES, timeAgo } from '../aiState';
import { BellIcon } from './Icons';

// The bell in the header: the runner's notifications (a prompt to approve, a task to review, a failed run,
// the usage limit). The list opens under it. Clicking one marks it read and opens its task.
//   notifications: the newest ones, newest first; unreadCount: the number on the bell
//   onOpen(): App reloads the list (there's no timer, so opening the bell is one of the moments it checks)
//   onOpenNotification(notification): App marks it read and opens its task
//   onMarkAllRead(): App marks them all read
function NotificationBell({ notifications, unreadCount, onOpen = () => {}, onOpenNotification, onMarkAllRead })
{
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef(null);

    // While it's open: Escape or a click anywhere else closes it
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        const handleClick = (e) => { if (!wrapperRef.current?.contains(e.target)) setIsOpen(false); };
        document.addEventListener('keydown', handleKey);
        document.addEventListener('mousedown', handleClick);
        return () => {
            document.removeEventListener('keydown', handleKey);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [isOpen]);

    const toggle = () => {
        if (!isOpen) onOpen();
        setIsOpen(!isOpen);
    };

    return(
        <div className="bell" ref={wrapperRef}>
            <button
                className="icon-btn bell-button"
                onClick={toggle}
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                aria-expanded={isOpen}
            >
                <BellIcon />
                {unreadCount > 0 && <span className="bell-count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>

            {isOpen && (
                <div className="bell-menu" role="region" aria-label="Notifications">
                    <div className="bell-menu-head">
                        <h2 className="bell-menu-title">Notifications</h2>
                        <button type="button" className="text-btn" onClick={onMarkAllRead} disabled={unreadCount === 0}>
                            Mark all read
                        </button>
                    </div>
                    {notifications.length === 0 ? (
                        <p className="bell-empty">You&apos;re all caught up.</p>
                    ) : (
                        <ul className="bell-list">
                            {notifications.map((n) => (
                                <li key={n.id}>
                                    <button
                                        type="button"
                                        className={n.readAt ? 'bell-item' : 'bell-item unread'}
                                        aria-label={[
                                            `${n.readAt ? '' : 'Unread: '}${n.message}`,
                                            n.task && `#${n.task.id} ${n.task.title}`,
                                            timeAgo(n.createdAt),
                                        ].filter(Boolean).join(', ')}
                                        onClick={() => {
                                            setIsOpen(false);
                                            onOpenNotification(n);
                                        }}
                                    >
                                        <span className={`dot dot-${NOTIFICATION_TONES[n.kind] ?? 'neutral'}`} aria-hidden="true" />
                                        <span className="bell-item-text">
                                            <span className="bell-item-message">{n.message}</span>
                                            {n.task && <span className="bell-item-task">#{n.task.id} {n.task.title}</span>}
                                        </span>
                                        <span className="bell-item-time">{timeAgo(n.createdAt)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

export default NotificationBell;
