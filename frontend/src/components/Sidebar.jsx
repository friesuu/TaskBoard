import { useEffect, useRef } from "react";
import { BoardIcon, ProfileIcon, PasswordIcon, LogoutIcon, ChatIcon } from "./SidebarIcons";

// The menu that slides in from the LEFT.
// It only shows buttons; App decides what each one does (the on... props).
// currentView ('board' or 'profile') tells it which page you're on, so that option can be highlighted.
function Sidebar({ isOpen, email, currentView, onClose, onBoard, onProfile, onChangePassword, onLogout, onChat })
{
    const closeButtonRef = useRef(null);

    // When it opens: move keyboard focus into the menu, so keyboard users land in it
    useEffect(() => {
        if (isOpen) closeButtonRef.current?.focus();
    }, [isOpen]);

    // While open: the Escape key closes it
    useEffect(() => {
        if (!isOpen) return;

        const handleKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey); // stop listening when it closes
    }, [isOpen, onClose]);

    // A page option: highlighted, and announced as "current page" to screen readers, when it's the page you're on
    const pageItem = (view, label, icon, onClick) => (
        <button
            className={currentView === view ? 'sidebar-item active' : 'sidebar-item'}
            aria-current={currentView === view ? 'page' : undefined}
            onClick={onClick}
        >
            {icon}
            <span>{label}</span>
        </button>
    );

    return(
        <>
            {/* The dark layer behind the menu; clicking it closes the menu */}
            <div className={isOpen ? 'sidebar-backdrop open' : 'sidebar-backdrop'} onClick={onClose} />

            {/* Always in the page so it can slide; "inert" makes it unclickable and unfocusable while closed */}
            <aside
                id="app-menu"
                className={isOpen ? 'sidebar open' : 'sidebar'}
                aria-label="Menu"
                inert={!isOpen}
            >
                <div className="sidebar-header">
                    <div>
                        <div className="sidebar-label">Logged in as</div>
                        <div className="sidebar-email">{email}</div>
                    </div>
                    <button ref={closeButtonRef} className="close-btn" onClick={onClose} aria-label="Close menu">
                        ✕
                    </button>
                </div>

                {/* Group 1: where you can go */}
                <nav className="sidebar-group" aria-label="Pages">
                    <div className="sidebar-group-title">Pages</div>
                    {pageItem('board', 'Board', <BoardIcon />, onBoard)}
                    {pageItem('profile', 'Profile', <ProfileIcon />, onProfile)}
                    {pageItem('chat', 'Assistant', <ChatIcon />, onChat)}
                </nav>

                {/* Group 2: account actions (these open something, they aren't pages) */}
                <div className="sidebar-group">
                    <div className="sidebar-group-title">Account</div>
                    <button className="sidebar-item" onClick={onChangePassword}>
                        <PasswordIcon />
                        <span>Change password</span>
                    </button>
                </div>

                {/* Pushed to the bottom and set apart, so it isn't clicked by accident */}
                <div className="sidebar-footer">
                    <button className="sidebar-item danger" onClick={onLogout}>
                        <LogoutIcon />
                        <span>Log out</span>
                    </button>
                </div>
            </aside>
        </>
    );
}

export default Sidebar;
