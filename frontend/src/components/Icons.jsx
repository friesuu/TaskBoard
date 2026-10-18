// General-purpose line icons, drawn the same way as SidebarIcons / TrashIcon / MenuIcon:
// inline SVG, 2px stroke, currentColor (each icon takes its button's text colour).
// They replace the plain characters the app used as icons (✕ ↑ ↓ ☑ ← +).

// The shared frame. aria-hidden: the button around the icon already has a name.
function Icon({ size = 18, children })
{
    return(
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

// ✕
export function CloseIcon({ size })
{
    return <Icon size={size}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Icon>;
}

// +
export function AddIcon({ size })
{
    return <Icon size={size}><path d="M12 5v14" /><path d="M5 12h14" /></Icon>;
}

// A gear, for Board settings
export function SettingsIcon({ size })
{
    return(
        <Icon size={size}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </Icon>
    );
}

// ↑ (also the chat "Send" arrow)
export function ArrowUpIcon({ size })
{
    return <Icon size={size}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Icon>;
}

// ↓
export function ArrowDownIcon({ size })
{
    return <Icon size={size}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Icon>;
}

// ←
export function ArrowLeftIcon({ size })
{
    return <Icon size={size}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></Icon>;
}

// A ticked box, for the checklist progress on a card
export function ChecklistIcon({ size })
{
    return(
        <Icon size={size}>
            <path d="m9 11 3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </Icon>
    );
}

// A calendar, next to due dates
export function CalendarIcon({ size })
{
    return(
        <Icon size={size}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4" />
            <path d="M8 2v4" />
            <path d="M3 10h18" />
        </Icon>
    );
}

// A magnifying glass, in the search box
export function SearchIcon({ size })
{
    return <Icon size={size}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
}

// ⌄ on buttons that open a menu
export function ChevronDownIcon({ size })
{
    return <Icon size={size}><path d="m6 9 6 6 6-6" /></Icon>;
}
