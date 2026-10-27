import { BoardIcon } from './SidebarIcons';
import { CalendarIcon } from './Icons';

// Board or Calendar: two ways of looking at the same tasks (a segmented control).
// view: 'board' or 'calendar'; onChange(newView) lets App switch.
function ViewSwitch({ view, onChange })
{
    // key: its keyboard shortcut (App listens for it), shown in the tooltip
    const option = (value, label, icon, key) => (
        <button
            className={view === value ? 'segment active' : 'segment'}
            aria-pressed={view === value}
            title={`${label} (${key})`}
            aria-keyshortcuts={key}
            onClick={() => onChange(value)}
        >
            {icon}
            {label}
        </button>
    );

    return(
        <div className="segmented" role="group" aria-label="View">
            {option('board', 'Board', <BoardIcon />, 'B')}
            {option('calendar', 'Calendar', <CalendarIcon />, 'C')}
        </div>
    );
}

export default ViewSwitch;
