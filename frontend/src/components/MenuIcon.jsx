// Three lines ("hamburger"). Inline SVG like TrashIcon; currentColor = the button's text colour.
function MenuIcon()
{
    return(
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
        </svg>
    );
}

export default MenuIcon;
