import { useEffect, useRef, useState } from "react";
import { getChatMessages, sendChatMessage, clearChat } from "../api";
import { ChatIcon } from "./SidebarIcons";
import { ArrowUpIcon } from "./Icons";

// The "Assistant" page. onSessionEnded comes from App: an expired login still goes back to the login screen.
// The assistant works on the board you have open (boardId): it only sees and changes tasks there.
function ChatPanel({ boardId, boardName, onSessionEnded })
{
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const [isWaiting, setIsWaiting] = useState(false);
    const [error, setError] = useState(null);
    const bottomRef = useRef(null);

    // Load the saved conversation when the page opens
    useEffect(() => {
        getChatMessages()
            .then(setMessages)
            .catch((err) => { if (!onSessionEnded(err)) setError(err.message); });
    }, [onSessionEnded]);

    // Keep the newest message in view
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isWaiting]);

    const handleSend = async (e) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text || isWaiting) return;

        setError(null);
        setDraft('');
        setIsWaiting(true);
        // Show your message straight away, with a temporary id until the server saves it
        const tempId = `pending-${Date.now()}`;
        setMessages((prev) => [...prev, { id: tempId, role: 'user', content: text }]);

        try
        {
            const answer = await sendChatMessage(boardId, text);
            setMessages((prev) => [...prev, answer]);
        }
        catch (err)
        {
            if (onSessionEnded(err)) return;
            setError(err.message);
            setMessages((prev) => prev.filter((m) => m.id !== tempId)); // it wasn't saved
            setDraft(text); // give the text back so you can retry
        }
        finally
        {
            setIsWaiting(false);
        }
    };

    // Enter sends, Shift+Enter starts a new line
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) handleSend(e);
    };

    const handleClear = async () => {
        if (!window.confirm('Delete the whole conversation?')) return;
        try
        {
            await clearChat();
            setMessages([]);
        }
        catch (err)
        {
            if (!onSessionEnded(err)) setError(err.message);
        }
    };

    // The assistant's messages: no bubble, a small avatar and a sender label (the design's "other messages")
    const assistantMessage = (key, children, extraClass = '') => (
        <div key={key} className={`chat-message assistant ${extraClass}`}>
            <span className="chat-avatar" aria-hidden="true"><ChatIcon /></span>
            <div className="chat-message-body">
                <div className="chat-sender">Assistant</div>
                <div className="chat-text">{children}</div>
            </div>
        </div>
    );

    return(
        <section className="chat">
            {/* The page title ("Assistant") is in App's header; this row says which board it works on */}
            <div className="chat-toolbar">
                {boardName && (
                    <span className="pill">
                        <span className="dot dot-info" aria-hidden="true" />
                        Working on: {boardName}
                    </span>
                )}
                <button className="btn btn-danger" onClick={handleClear} disabled={messages.length === 0 || isWaiting}>
                    Clear chat
                </button>
            </div>

            <div className="chat-messages">
                <div className="chat-thread">
                    {messages.length === 0 && !isWaiting && (
                        <div className="empty-state">
                            <span className="empty-state-icon" aria-hidden="true"><ChatIcon /></span>
                            <h3>Ask about your tasks</h3>
                            <p>e.g. "What should I do first?"</p>
                        </div>
                    )}
                    {/* Plain text only: React escapes it, so an answer can never inject HTML */}
                    {messages.map((m) => (m.role === 'user'
                        ? <div key={m.id} className="chat-message user"><div className="chat-bubble">{m.content}</div></div>
                        : assistantMessage(m.id, m.content)
                    ))}
                    {isWaiting && assistantMessage(
                        'waiting',
                        <span className="loading"><span className="spinner" aria-hidden="true" />Thinking…</span>,
                        'waiting',
                    )}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* The composer: stays at the bottom while the messages scroll */}
            <div className="chat-composer">
                {error && <p className="error-message">{error}</p>}
                <form className="composer-box" onSubmit={handleSend}>
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        maxLength={2000}
                        rows={1}
                        placeholder="Ask about the tasks on this board…"
                        aria-label="Message"
                    />
                    <button type="submit" className="send-btn" aria-label="Send" disabled={isWaiting || !draft.trim()}>
                        <ArrowUpIcon />
                    </button>
                </form>
            </div>
        </section>
    );
}

export default ChatPanel;