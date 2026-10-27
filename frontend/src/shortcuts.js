// The keyboard shortcuts: single keys, only used when you're not typing somewhere.
// Matched on event.key (the character typed), not the physical key: / and ? sit on
// different keys on different keyboard layouts.
export const SHORTCUTS = [
  { action: 'add', keys: ['n', 'N'], label: 'N', description: 'Add a task' },
  { action: 'search', keys: ['/'], label: '/', description: 'Search tasks' },
  { action: 'board', keys: ['b', 'B'], label: 'B', description: 'Board view' },
  { action: 'calendar', keys: ['c', 'C'], label: 'C', description: 'Calendar view' },
  { action: 'help', keys: ['?'], label: '?', description: 'Show these shortcuts' },
];

// Somewhere you type: a key pressed there is text, not a shortcut
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
export const isTyping = (target) => Boolean(target?.isContentEditable || target?.closest?.(EDITABLE));

// The action for this keydown ('add', 'search'...), or null when it isn't a shortcut.
// Ctrl, Alt and Meta belong to the browser and the system; Shift is fine (? needs it).
export function shortcutFor(event)
{
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (isTyping(event.target)) return null;
  return SHORTCUTS.find((s) => s.keys.includes(event.key))?.action ?? null;
}
