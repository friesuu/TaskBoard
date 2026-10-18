import { getUrlParam, setUrlParam } from './url';

// The board's search and filters, as App keeps them:
//   q: search text, labels: label ids (ANY of them), due: one DUE_OPTIONS value or '', status: column values
export const EMPTY_FILTERS = { q: '', labels: [], due: '', status: [] };

export const DUE_OPTIONS = [
    { value: 'OVERDUE', label: 'Overdue' },
    { value: 'TODAY', label: 'Due today' },
    { value: 'THIS_WEEK', label: 'Due this week' },
    { value: 'NO_DATE', label: 'No due date' },
];

// Is any filter switched on?
export function hasActiveFilters(filters)
{
    return Boolean(filters.q.trim() || filters.labels.length || filters.due || filters.status.length);
}

// What the server's TaskFilterInput expects, or null when nothing is filtered
export function toApiFilter(filters)
{
    if (!hasActiveFilters(filters)) return null;
    const filter = {};
    if (filters.q.trim()) filter.q = filters.q.trim();
    if (filters.labels.length) filter.labelIds = filters.labels;
    if (filters.status.length) filter.statuses = filters.status;
    if (filters.due) filter.due = filters.due;
    return filter;
}

// ----- The address bar: ?q=report&labels=3,7&due=OVERDUE&status=TODO,DONE -----

const list = (value) => (value ? value.split(',').filter(Boolean) : []);

// Filters from the address bar (anything unknown is ignored)
export function readFiltersFromUrl()
{
    const due = getUrlParam('due') ?? '';
    return {
        q: getUrlParam('q') ?? '',
        labels: list(getUrlParam('labels')).map(Number).filter(Number.isInteger),
        due: DUE_OPTIONS.some((o) => o.value === due) ? due : '',
        status: list(getUrlParam('status')),
    };
}

// Filters into the address bar; empty ones are removed from it
export function writeFiltersToUrl(filters)
{
    setUrlParam('q', filters.q.trim() || null);
    setUrlParam('labels', filters.labels.join(',') || null);
    setUrlParam('due', filters.due || null);
    setUrlParam('status', filters.status.join(',') || null);
}
