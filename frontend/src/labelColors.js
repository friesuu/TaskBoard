// The fixed label palette. value = what the server stores (GraphQL enum), name = what people see.
// No red on purpose: red means "overdue" everywhere in the app.
export const LABEL_COLORS = [
    { value: 'GRAY', name: 'Grey' },
    { value: 'BLUE', name: 'Blue' },
    { value: 'PURPLE', name: 'Purple' },
    { value: 'TEAL', name: 'Teal' },
    { value: 'GREEN', name: 'Green' },
    { value: 'YELLOW', name: 'Yellow' },
    { value: 'ORANGE', name: 'Orange' },
    { value: 'PINK', name: 'Pink' },
];

// The CSS class that gives an element its label colour, e.g. 'BLUE' -> 'label-blue'
export function labelColorClass(color)
{
    return `label-${color.toLowerCase()}`;
}

// Labels are always shown A to Z
export function sortLabels(labels)
{
    return [...labels].sort((a, b) => a.name.localeCompare(b.name));
}
