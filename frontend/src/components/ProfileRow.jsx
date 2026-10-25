import { ChevronDownIcon } from './Icons';

// One row of the profile's settings list (like the calorie tracker's): its name, a short preview and a chevron.
// Clicking it opens its content right under it, like a dropdown; clicking again folds it away.
// Profile decides which row is open (one at a time). danger: red name, for "Delete account".
function ProfileRow({ id, label, preview, isOpen, onToggle, danger = false, children })
{
    const panelId = `profile-panel-${id}`;

    return(
        <li className={danger ? 'settings-item danger' : 'settings-item'}>
            <button
                type="button"
                className="settings-row"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={onToggle}
            >
                <span className="settings-text">
                    <span className="settings-label">{label}</span>
                    <span className="settings-preview">{preview}</span>
                </span>
                <span className="settings-chevron" aria-hidden="true"><ChevronDownIcon size={18} /></span>
            </button>

            {isOpen && (
                <div id={panelId} className="settings-panel" role="region" aria-label={label}>
                    {children}
                </div>
            )}
        </li>
    );
}

export default ProfileRow;
