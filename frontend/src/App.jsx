import './App.css';
import { useState, useEffect, useCallback } from 'react';
import {
  getTasks, createTask, updateTask, moveTask, deleteTask, getCurrentUser, logout, changePassword,
  getBoards, createBoard, renameBoard, deleteBoard,
} from './api';
import Column from './components/Column';
import TaskForm from './components/TaskFrom';
import LoginForm from './components/LoginForm';
import ChangePasswordForm from './components/ChangePasswordForm';
import Sidebar from './components/Sidebar';
import Profile from './components/Profile';
import MenuIcon from './components/MenuIcon';
import { STATUSES } from './statuses';
import { moveInList } from './reorder';
import { DragDropContext} from '@hello-pangea/dnd';
import ChatPanel from './components/ChatPanel';
import BoardNameForm from './components/BoardNameForm';
import BoardSettings from './components/BoardSettings';
import { getUrlParam, setUrlParam } from './url';
import { AddIcon, CloseIcon, SettingsIcon } from './components/Icons';
import TaskDetails from './components/TaskDetails';

const SESSION_EXPIRED = 'Your session has expired. Please log in again.';

// The heading of each modal (openModal decides which one is open)
const MODAL_TITLES = {
  add: 'Add New Task',
  password: 'Change Password',
  'new-board': 'New Board',
  'board-settings': 'Board Settings',
};

function App()
{
  // undefined = still asking the server, null = nobody logged in, object = the logged-in user
  const [user, setUser] = useState(undefined);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null); // e.g. "Password changed"
  const [openModal, setOpenModal] = useState(null); // null = closed, otherwise a key of MODAL_TITLES
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [view, setView] = useState('board'); // which page is shown: 'board', 'profile' or 'chat'
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(null); // the open board; null until the boards have loaded
  const [openTaskId, setOpenTaskId] = useState(null); // which task's panel is open (null = none)

  const currentBoard = boards.find((b) => b.id === boardId);
  const openTask = tasks.find((t) => t.id === openTaskId);

  // useCallback keeps this the SAME function on every render. Sidebar's Escape-key effect depends on it,
  // so a new function each render would make that effect stop and restart every time App re-renders.
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);

  // Once, when the page opens: ask the server who is logged in (the cookie is httpOnly, so we can't look ourselves)
  // [] = only once. Never list `user` here: every answer is a new object, so the effect would
  // run again, ask again, get another new object... an endless stream of requests.
  useEffect(() => {
    getCurrentUser().then(setUser).catch((err) => setError(err.message));
  }, []);

  // For the two loading effects below: an expired cookie goes back to the login screen, anything else is shown
  const loadFailed = useCallback((err) => {
    if (err.code === 'UNAUTHENTICATED')
    {
      setUser(null); // the cookie expired between "me" and this request
      setError(SESSION_EXPIRED);
    }
    else
    {
      setError(err.message);
    }
  }, []);

  // Opens a board and puts it in the address bar (?board=3), so a refresh or a bookmark opens the same board
  const selectBoard = useCallback((id) => {
    setBoardId(id);
    setUrlParam('board', id);
  }, []);

  // After logging in: load your boards, then open the one in the address bar (if it's yours) or else the first
  useEffect(() => {
    if (!user) return;
    getBoards().then((list) => {
      setBoards(list);
      const fromUrl = Number(getUrlParam('board'));
      selectBoard(list.some((b) => b.id === fromUrl) ? fromUrl : (list[0]?.id ?? null));
    }).catch(loadFailed);
  }, [user, selectBoard, loadFailed]);

  // Whenever the open board changes, or you switch pages: load that board's tasks.
  // Switching pages reloads them so changes made by the assistant show up on the board.
  useEffect(() => {
    if (!user || boardId === null) return;
    // If you switch boards again before this answer arrives, the cleanup below sets this,
    // so a slow answer for the OLD board can't replace the new board's tasks.
    let isStale = false;
    getTasks(boardId)
      .then((list) => { if (!isStale) setTasks(list); })
      .catch(loadFailed);
    return () => { isStale = true; };
  }, [user, boardId, view, loadFailed]);

  // Back to the login screen. Also empties the board, so the next person on this computer
  // never sees the previous user's tasks, not even for a moment.
  const showLogin = useCallback((message = null) => {
    setUser(null);
    setTasks([]);
    setBoards([]);
    setBoardId(null);
    setUrlParam('board', null); // the next person starts on their own first board
    setOpenModal(null);
    setIsSidebarOpen(false);
    setView('board'); // the next person to log in starts on the board, not on someone's profile
    setSuccess(null);
    setError(message);
  }, []);

  // If a request failed because the login cookie expired (or was removed), go to the login screen.
  // Returns true when it handled the error, so the caller knows not to show it too.
  const endedSession = useCallback((err) => {
    if (err.code !== 'UNAUTHENTICATED') return false;
    showLogin(SESSION_EXPIRED);
    return true;
  }, [showLogin]); // it uses showLogin, so it lists it

  const handleLoggedIn = (loggedInUser) => {
    setError(null); // clear "session expired" etc.
    setUser(loggedInUser); // the effect above then loads their tasks
  };

  const handleLogout = async () => {
    try{
      await logout(); // only the server can delete the httpOnly cookie
      showLogin();
    }
    catch(err){
      setError(`Couldn't log out: ${err.message}`); // the cookie is still there, so don't pretend
    }
  };

  // Errors here are shown inside the form, so only an expired session is handled
  const handleCreate = async (data) => {
    try{
      const created = await createTask({ ...data, boardId }); // on the open board
      setTasks((prev) => [...prev, created]);
      setOpenModal(null);
    }
    catch(err){
      if (!endedSession(err)) throw err; // the form shows it
    }
  };

  // The server logs out every other device and gives THIS one a fresh cookie, so we stay on the board
  const handleChangePassword = async (currentPassword, newPassword) => {
    try{
      await changePassword(currentPassword, newPassword);
      setOpenModal(null);
      setSuccess('Password changed. Any other device you were logged in on has been logged out.');
    }
    catch(err){
      if (!endedSession(err)) throw err; // the form shows it, e.g. "Current password is incorrect"
    }
  };

  const openForm = (name) => {
    setSuccess(null);
    setOpenModal(name);
  };

  // What each sidebar option does. Every one closes the menu first.
  const goToBoard = () => {
    closeSidebar();
    setView('board');
  };

  const goToProfile = () => {
    closeSidebar();
    setSuccess(null);
    setView('profile');
  };

  const goToChat = () => {
    closeSidebar();
    setSuccess(null);
    setView('chat');
  };

  // Open another board. Its tasks are cleared first, so you never drag a card from the old board.
  const switchBoard = (id) => {
    closeSidebar();
    setSuccess(null);
    setView('board');
    if (id !== boardId)
    {
      setTasks([]);
      selectBoard(id);
    }
  };

  const newBoardFromMenu = () => {
    closeSidebar();
    openForm('new-board');
  };

  // The form shows errors (e.g. an empty name); only an expired session is handled here
  const handleCreateBoard = async (name) => {
    try{
      const board = await createBoard(name);
      setBoards((prev) => [...prev, board]);
      setOpenModal(null);
      switchBoard(board.id); // a new board opens straight away
    }
    catch(err){
      if (!endedSession(err)) throw err;
    }
  };

  const handleRenameBoard = async (name) => {
    try{
      const renamed = await renameBoard(boardId, name);
      setBoards((prev) => prev.map((b) => (b.id === renamed.id ? renamed : b)));
      setOpenModal(null);
    }
    catch(err){
      if (!endedSession(err)) throw err;
    }
  };

  // The server deletes the board's tasks too. Afterwards you land on your first remaining board.
  const handleDeleteBoard = async () => {
    try{
      await deleteBoard(boardId);
      const remaining = boards.filter((b) => b.id !== boardId);
      setBoards(remaining);
      setOpenModal(null);
      setTasks([]);
      selectBoard(remaining[0].id);
    }
    catch(err){
      if (!endedSession(err)) throw err; // BoardSettings shows it
    }
  };

  const changePasswordFromMenu = () => {
    closeSidebar();
    openForm('password');
  };

  const logoutFromMenu = () => {
    closeSidebar(); // so a "Couldn't log out" error isn't hidden behind the menu
    handleLogout();
  };

  // Optimistic: move the card on screen first, then save. If the save fails, undo.
  const handleMove = async (id, status, index) => {
    const previous = tasks;

    setError(null);
    setTasks((prev) => moveInList(prev, id, status, index));

    try{
      const moved = await moveTask(id, status, index);
      setTasks((prev) => prev.map((b) => (b.id === id ? moved : b)));
    }
    catch(err){
      if (endedSession(err)) return;
      setError(err.message);
      try{
        setTasks(await getTasks(boardId)); // the server knows the real order
      }
      catch{
        setTasks(previous); // server unreachable: put the board back as it was
      }
    }
  };

  // The dropdown sends the task to the bottom of the chosen column
  const handleStatusChange = (id, status) => {
    const bottom = tasks.filter((t) => t.status === status && t.id !== id).length;
    handleMove(id, status, bottom);
  };

  const handleDelete = async (id) => {
    try{
      await deleteTask(id);
      setTasks((prev) => prev.filter((b) => b.id !== id));
    }
    catch(err){
      if (!endedSession(err)) setError(err.message);
    }
  }

  const handleEdit = async (id, changes) => {
    try{
      const updated = await updateTask(id, changes);
      setTasks((prev) => prev.map((b) => (b.id === id? updated : b)));
    }
    catch(err){
      if (!endedSession(err)) throw err; // the edit form shows it
    }
  }

  // The checklist in the details panel changed: update the "2/5" on that task's card (no server call needed)
  const handleChecklistProgress = (id, checklistDone, checklistTotal) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, checklistDone, checklistTotal } : t)));
  };

  const handleDragEnd = ({ source, destination, draggableId }) => {
    if (!destination) return; // dropped outside a column, or Esc pressed
    if (destination.droppableId === source.droppableId && destination.index === source.index) return; // dropped where it was

    handleMove(Number(draggableId), destination.droppableId, destination.index);
  }

  // Choose the screen. These come after all the hooks above: React needs the same hooks on every render.
  if (user === undefined)
  {
    // Still waiting for "me". If that failed (server down...), show why instead of loading forever.
    return(
      <main className="center-screen">
        {error
          ? <p className="error-message">{error}</p>
          : <p className="loading"><span className="spinner" aria-hidden="true" />Loading…</p>}
      </main>
    );
  }
  if (user === null)
  {
    return <LoginForm onLoggedIn={handleLoggedIn} notice={error} />;
  }

  // The page header's title: the open board's name, or the page you're on
  const pageTitle = view === 'profile' ? 'Profile' : view === 'chat' ? 'Assistant' : (currentBoard?.name ?? '');

  return(
    // The app shell: the dark page with the main panel on it. The navigation (Sidebar) slides in over it.
    <div className="app-shell">
      <main className="main-panel">
        {/* Page header: menu button and page title on the left, this page's actions on the right */}
        <header className="page-header">
          <div className="page-header-title">
            {/* aria-expanded tells screen readers whether the menu is open */}
            <button
              className="icon-btn"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open menu"
              aria-expanded={isSidebarOpen}
              aria-controls="app-menu"
            >
              <MenuIcon />
            </button>
            <h1 className="page-title">{pageTitle}</h1>
          </div>

          {view === 'board' && (
            <div className="page-actions">
              {currentBoard && (
                <button className="btn btn-secondary" onClick={() => openForm('board-settings')}>
                  <SettingsIcon size={16} />
                  Board settings
                </button>
              )}
              <button className="btn btn-primary" onClick={() => openForm('add')}>
                <AddIcon size={16} />
                Add task
              </button>
            </div>
          )}
        </header>

        {/* Only this part scrolls; the header stays put. The chat manages its own scrolling. */}
        <div className={view === 'chat' ? 'page-content page-content-chat' : 'page-content'}>
          {error && <p className="error-message">{error}</p>}
          {success && <p className="success-message">{success}</p>}

          {/* "view" picks the page. Both use the same tasks, so the profile's numbers are always up to date. */}
          {view === 'chat' && (
            <ChatPanel boardId={boardId} boardName={currentBoard?.name} onSessionEnded={endedSession} />
          )}

          {view === 'profile' && (
            <Profile
              user={user}
              tasks={tasks}
              boardName={currentBoard?.name}
              onBack={() => setView('board')}
              onChangePassword={() => openForm('password')}
            />
          )}

          {view === 'board' && (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="board">
              {STATUSES.map((s) => (
                <Column
                key={s.value}
                title={s.label}
                tasks={tasks.filter((t) => t.status === s.value)}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onOpen={setOpenTaskId}
                status={s.value}
                />
              ))}
              </div>
            </DragDropContext>
          )}
        </div>
      </main>

      <Sidebar
        isOpen={isSidebarOpen}
        email={user.email}
        currentView={view}
        boards={boards}
        currentBoardId={boardId}
        onSelectBoard={switchBoard}
        onNewBoard={newBoardFromMenu}
        onClose={closeSidebar}
        onBoard={goToBoard}
        onProfile={goToProfile}
        onChat={goToChat}
        onChangePassword={changePasswordFromMenu}
        onLogout={logoutFromMenu}
      />

      {/* One modal; openModal decides which form is inside it */}
      {openModal && (
        <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h2 id="modal-title">{MODAL_TITLES[openModal]}</h2>
              <button className="icon-btn" onClick={() => setOpenModal(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </header>

            <div className="modal-body">
              {openModal === 'add' && <TaskForm onCreate={handleCreate} />}
              {openModal === 'password' && (
                <ChangePasswordForm email={user.email} onChangePassword={handleChangePassword} />
              )}
              {openModal === 'new-board' && <BoardNameForm submitLabel="Create board" onSubmit={handleCreateBoard} />}
              {openModal === 'board-settings' && currentBoard && (
                <BoardSettings
                  board={currentBoard}
                  canDelete={boards.length > 1}
                  onRename={handleRenameBoard}
                  onDelete={handleDeleteBoard}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {openTask && (
        <TaskDetails
          task={openTask}
          currentUserId={user.id}
          onSave={handleEdit}
          onChecklistProgress={handleChecklistProgress}
          onSessionEnded={endedSession}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  );
}
export default App;
