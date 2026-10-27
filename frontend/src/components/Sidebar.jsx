import { useEffect, useRef } from "react";
import { BoardIcon, ProfileIcon, PasswordIcon, LogoutIcon, ChatIcon, PlusIcon, ActivityIcon } from "./SidebarIcons";
import { CloseIcon } from "./Icons";

// The menu that slides in from the LEFT.
// It only shows buttons; App decides what each one does (the on... props).
// currentView ('board' or 'profile') tells it which page you're on, so that option can be highlighted.
// boards + currentBoardId: the list of your boards, and which one is open.
function Sidebar({
    isOpen, email, name, currentView, boards = [], currentBoardId,
    onClose, onBoard, onProfile, onChangePassword, onLogout, onChat, onSelectBoard, onNewBoard, onAiActivity = () => {},
})
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
                {/* The app's name, and who is logged in */}
                <div className="sidebar-header">
                    <div className="sidebar-brand">
                        <span className="sidebar-brand-mark" aria-hidden="true"><BoardIcon /></span>
                        <span className="sidebar-brand-name">Task Board</span>
                    </div>
                    <button ref={closeButtonRef} className="icon-btn" onClick={onClose} aria-label="Close menu">
                        <CloseIcon />
                    </button>
                </div>
                <div className="sidebar-account">
                    <div className="sidebar-group-title">Logged in as</div>
                    {/* Your display name if you've set one (the email stays in the tooltip), else the email */}
                    <div className="sidebar-email" title={email}>{name || email}</div>
                </div>

                {/* Group 1: where you can go */}
                <nav className="sidebar-group" aria-label="Pages">
                    <div className="sidebar-group-title">Pages</div>
                    {pageItem('board', 'Board', <BoardIcon />, onBoard)}
                    {pageItem('ai', 'AI Activity', <ActivityIcon />, onAiActivity)}
                    {pageItem('profile', 'Profile', <ProfileIcon />, onProfile)}
                    {pageItem('chat', 'Assistant', <ChatIcon />, onChat)}
                </nav>

                {/* Your boards: click one to open it */}
                <nav className="sidebar-group" aria-label="Boards">
                    <div className="sidebar-group-title">Boards</div>
                    <div className="sidebar-boards">
                        {boards.map((b) => (
                            <button
                                key={b.id}
                                className={b.id === currentBoardId ? 'sidebar-item board-item active' : 'sidebar-item board-item'}
                                aria-current={b.id === currentBoardId ? 'true' : undefined}
                                onClick={() => onSelectBoard(b.id)}
                                title={b.name}
                            >
                                {/* A dot instead of an icon: accent for the open board */}
                                <span className="nav-dot" aria-hidden="true" />
                                <span>{b.name}</span>
                            </button>
                        ))}
                    </div>
                    <button className="sidebar-item sidebar-item-add" onClick={onNewBoard}>
                        <PlusIcon />
                        <span>New board</span>
                    </button>
                </nav>

                {/* Account actions (these open something, they aren't pages) */}
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
