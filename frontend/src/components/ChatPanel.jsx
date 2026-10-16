import { useEffect, useRef, useState } from "react";
import { getChatMessages, sendChatMessage, clearChat } from "../api";

// The "Assistant" page. onSessionEnded comes from App: an expired login still goes back to the login screen.
function ChatPanel({ onSessionEnded })
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
            const answer = await sendChatMessage(text);
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

    return(
        <section className="chat">
            <div className="chat-header">
                <h2>Assistant</h2>
                <button className="logout-btn" onClick={handleClear} disabled={messages.length === 0 || isWaiting}>
                    Clear chat
                </button>
            </div>

            <div className="chat-messages">
                {messages.length === 0 && !isWaiting && (
                    <p className="chat-empty">Ask about your tasks, e.g. "What should I do first?"</p>
                )}
                {/* Plain text only: React escapes it, so an answer can never inject HTML */}
                {messages.map((m) => (
                    <div key={m.id} className={`chat-bubble ${m.role}`}>{m.content}</div>
                ))}
                {isWaiting && <div className="chat-bubble assistant waiting">Thinking…</div>}
                <div ref={bottomRef} />
            </div>

            {error && <p className="error-message">{error}</p>}

            <form className="chat-input" onSubmit={handleSend}>
                <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={2000}
                    rows={2}
                    placeholder="Ask about your tasks…"
                    aria-label="Message"
                />
                <button type="submit" className="add-task-btn" disabled={isWaiting || !draft.trim()}>
                    Send
                </button>
            </form>
        </section>
    );
}

export default ChatPanel;