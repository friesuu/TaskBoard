// Small line icons for the sidebar options. Inline SVG like TrashIcon and MenuIcon:
// no icon library needed, and currentColor makes each icon take its button's text colour.

// The shared frame: size, line style, and hidden from screen readers (the button's text already says what it is)
function Icon({ children })
{
    return(
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {children}
        </svg>
    );
}

// Three columns, like the board
export function BoardIcon()
{
    return(
        <Icon>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            <path d="M15 4v16" />
        </Icon>
    );
}

// A head and shoulders
export function ProfileIcon()
{
    return(
        <Icon>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </Icon>
    );
}

// A padlock
export function PasswordIcon()
{
    return(
        <Icon>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </Icon>
    );
}

// An arrow leaving a door
export function LogoutIcon()
{
    return(
        <Icon>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
        </Icon>
    );
}

// A speech bubble
export function ChatIcon()
{
    return(
        <Icon>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </Icon>
    );
}
