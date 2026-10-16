import './App.css';
import { useState, useEffect, useCallback } from 'react';
import { getTasks, createTask, updateTask, moveTask, deleteTask, getCurrentUser, logout, changePassword } from './api';
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

const SESSION_EXPIRED = 'Your session has expired. Please log in again.';

function App()
{
  // undefined = still asking the server, null = nobody logged in, object = the logged-in user
  const [user, setUser] = useState(undefined);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null); // e.g. "Password changed"
  const [openModal, setOpenModal] = useState(null); // null = closed, 'add' = Add Task, 'password' = Change password
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [view, setView] = useState('board'); // which page is shown: 'board' or 'profile'

  // useCallback keeps this the SAME function on every render. Sidebar's Escape-key effect depends on it,
  // so a new function each render would make that effect stop and restart every time App re-renders.
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);

  // Once, when the page opens: ask the server who is logged in (the cookie is httpOnly, so we can't look ourselves)
  // [] = only once. Never list `user` here: every answer is a new object, so the effect would
  // run again, ask again, get another new object... an endless stream of requests.
  useEffect(() => {
    getCurrentUser().then(setUser).catch((err) => setError(err.message));
  }, []);

  // Whenever the user changes (e.g. right after logging in), or you switch pages: load that user's tasks.
  // Switching pages reloads them so changes made by the assistant show up on the board.
  useEffect(() => {
    if (!user) return;
    getTasks().then(setTasks).catch((err) => {
      if (err.code === 'UNAUTHENTICATED')
      {
        setUser(null); // the cookie expired between "me" and loading the tasks
        setError(SESSION_EXPIRED);
      }
      else
      {
        setError(err.message);
      }
    });
  }, [user, view]);

  // Back to the login screen. Also empties the board, so the next person on this computer
  // never sees the previous user's tasks, not even for a moment.
  const showLogin = useCallback((message = null) => {
    setUser(null);
    setTasks([]);
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
      const created = await createTask(data);
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
        setTasks(await getTasks()); // the server knows the real order
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

  const handleDragEnd = ({ source, destination, draggableId }) => {
    if (!destination) return; // dropped outside a column, or Esc pressed
    if (destination.droppableId === source.droppableId && destination.index === source.index) return; // dropped where it was

    handleMove(Number(draggableId), destination.droppableId, destination.index);
  }

  // Choose the screen. These come after all the hooks above: React needs the same hooks on every render.
  if (user === undefined)
  {
    // Still waiting for "me". If that failed (server down...), show why instead of loading forever.
    return <main className="container">{error ? <p className="error-message">{error}</p> : <p>Loading…</p>}</main>;
  }
  if (user === null)
  {
    return <LoginForm onLoggedIn={handleLoggedIn} notice={error} />;
  }

  return(
    <main className="container">
      <header className="header">
        {/* Menu button on the LEFT, next to the title, because the menu now slides in from the left */}
        <div className="header-left">
          {/* aria-expanded tells screen readers whether the menu is open */}
          <button
            className="menu-btn"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open menu"
            aria-expanded={isSidebarOpen}
            aria-controls="app-menu"
          >
            <MenuIcon />
          </button>
          <h1 className='header-title'>
            Task Board
          </h1>
        </div>
        <div className="header-user">
          {view === 'board' && (
            <button className="add-task-btn" onClick={() => openForm('add')}>
              + Add Task
            </button>
          )}
        </div>
      </header>

      <Sidebar
        isOpen={isSidebarOpen}
        email={user.email}
        currentView={view}
        onClose={closeSidebar}
        onBoard={goToBoard}
        onProfile={goToProfile}
        onChat={goToChat}
        onChangePassword={changePasswordFromMenu}
        onLogout={logoutFromMenu}
      />

      {error && <p className="error-message">{error}</p>}
      {success && <p className="success-message">{success}</p>}

      {/* One modal; openModal decides which form is inside it */}
      {openModal && (
        <div className="modal-backdrop" onClick={() => setOpenModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2>{openModal === 'add' ? 'Add New Task' : 'Change Password'}</h2>
              <button
                className="close-btn"
                onClick={() => setOpenModal(null)}
              >
                ✕
              </button>
            </header>

            {openModal === 'add'
              ? <TaskForm onCreate={handleCreate} />
              : <ChangePasswordForm email={user.email} onChangePassword={handleChangePassword} />}
          </div>
        </div>
      )}

      {/* "view" picks the page. Both use the same tasks, so the profile's numbers are always up to date. */}
      {view === 'chat' && <ChatPanel onSessionEnded={endedSession} />}

      {view === 'profile' && (
        <Profile
          user={user}
          tasks={tasks}
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
            onEdit={handleEdit}
            status={s.value}
            />
          ))}
          </div>
        </DragDropContext>
      )}
      
    </main>
  );
}
export default App;
