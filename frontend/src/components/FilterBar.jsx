import { useEffect, useRef, useState } from 'react';
import { STATUSES } from '../statuses';
import { DUE_OPTIONS, EMPTY_FILTERS, hasActiveFilters } from '../filters';
import { labelColorClass } from '../labelColors';
import { ChevronDownIcon, SearchIcon } from './Icons';

const SEARCH_DELAY = 300; // ms: search once typing pauses, not on every key

// Adds or removes one value from a list (for the label and column choices)
const toggleIn = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

// The search box and filters above the board. It doesn't load anything itself:
// every change goes to App through onChange(newFilters), and App reloads the tasks.
//   filters: { q, labels, due, status } (see filters.js)   labels: the board's labels
//   searchRef: optional, gets the search box (so App's / shortcut can focus it)
function FilterBar({ filters, labels, onChange, searchRef })
{
    // The search box shows what you type straight away; the search itself waits for a pause
    const [draft, setDraft] = useState(filters.q);
    const [shownQ, setShownQ] = useState(filters.q);
    if (filters.q !== shownQ)
    {
        // The search was changed from outside (e.g. Clear filters): show that instead
        setShownQ(filters.q);
        setDraft(filters.q);
    }

    useEffect(() => {
        if (draft === filters.q) return;
        const timer = setTimeout(() => onChange({ ...filters, q: draft }), SEARCH_DELAY);
        return () => clearTimeout(timer); // typed again before the pause: start waiting again
    }, [draft, filters, onChange]);

    // The Labels menu: closes on a click outside it or on Escape
    const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
    const labelMenuRef = useRef(null);
    useEffect(() => {
        if (!isLabelMenuOpen) return;
        const closeOnOutsideClick = (e) => {
            if (!labelMenuRef.current?.contains(e.target)) setIsLabelMenuOpen(false);
        };
        const closeOnEscape = (e) => {
            if (e.key === 'Escape') setIsLabelMenuOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isLabelMenuOpen]);

    // Only count labels that are on this board (an old id in the address bar is ignored)
    const chosenLabels = filters.labels.filter((id) => labels.some((l) => l.id === id));
    const isActive = hasActiveFilters(filters);

    return(
        <div className="filters">
            <div className="filter-bar" role="search">
                <div className="filter-search">
                    <SearchIcon size={16} />
                    <input
                        ref={searchRef}
                        type="search"
                        title="Search tasks (/)"
                        aria-keyshortcuts="/"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={100}
                        placeholder="Search tasks…"
                        aria-label="Search tasks"
                    />
                </div>

                <div className="filter-menu" ref={labelMenuRef}>
                    <button
                        className="btn btn-secondary"
                        onClick={() => setIsLabelMenuOpen(!isLabelMenuOpen)}
                        aria-expanded={isLabelMenuOpen}
                        aria-haspopup="true"
                        // Said out loud as "Labels, 2 chosen" (the count pill alone would read as "Labels2")
                        aria-label={chosenLabels.length > 0 ? `Labels, ${chosenLabels.length} chosen` : 'Labels'}
                    >
                        Labels
                        {chosenLabels.length > 0 && <span className="pill pill-count">{chosenLabels.length}</span>}
                        <ChevronDownIcon size={16} />
                    </button>
                    {isLabelMenuOpen && (
                        <div className="menu" role="group" aria-label="Show tasks with any of these labels">
                            {labels.length === 0 ? (
                                <p className="menu-empty">No labels on this board yet.</p>
                            ) : labels.map((l) => (
                                <label key={l.id} className="menu-item">
                                    <input
                                        type="checkbox"
                                        checked={filters.labels.includes(l.id)}
                                        onChange={() => onChange({ ...filters, labels: toggleIn(filters.labels, l.id) })}
                                    />
                                    <span className={`dot label-dot ${labelColorClass(l.color)}`} aria-hidden="true" />
                                    <span>{l.name}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                <select
                    className="filter-due"
                    value={filters.due}
                    onChange={(e) => onChange({ ...filters, due: e.target.value })}
                    aria-label="Due date"
                >
                    <option value="">Any due date</option>
                    {DUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>

                {/* Columns: toggle buttons; pressed ones are shown */}
                <div className="filter-chips" role="group" aria-label="Columns">
                    {STATUSES.map((s) => (
                        <button
                            key={s.value}
                            className="chip"
                            aria-pressed={filters.status.includes(s.value)}
                            onClick={() => onChange({ ...filters, status: toggleIn(filters.status, s.value) })}
                        >
                            <span className={`dot dot-${s.tone}`} aria-hidden="true" />
                            {s.label}
                        </button>
                    ))}
                </div>

                {isActive && (
                    <button className="btn btn-ghost" onClick={() => onChange(EMPTY_FILTERS)}>
                        Clear filters
                    </button>
                )}
            </div>

            {isActive && (
                <p className="filter-hint">
                    Filters are on, so cards can't be dragged. Clear them to reorder.
                </p>
            )}
        </div>
    );
}

export default FilterBar;
