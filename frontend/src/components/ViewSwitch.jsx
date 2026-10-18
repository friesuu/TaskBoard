import { BoardIcon } from './SidebarIcons';
import { CalendarIcon } from './Icons';

// Board or Calendar: two ways of looking at the same tasks (a segmented control).
// view: 'board' or 'calendar'; onChange(newView) lets App switch.
function ViewSwitch({ view, onChange })
{
    const option = (value, label, icon) => (
        <button
            className={view === value ? 'segment active' : 'segment'}
            aria-pressed={view === value}
            onClick={() => onChange(value)}
        >
            {icon}
            {label}
        </button>
    );

    return(
        <div className="segmented" role="group" aria-label="View">
            {option('board', 'Board', <BoardIcon />)}
            {option('calendar', 'Calendar', <CalendarIcon />)}
        </div>
    );
}

export default ViewSwitch;
