import { useState } from "react";
import { login, register } from "../api";

// Shown instead of the board when nobody is logged in.
// onLoggedIn(user) comes from App: calling it tells App who logged in, and App shows the board.
// notice: a message from App to show above the form, e.g. "Your session has expired".
function LoginForm({ onLoggedIn, notice })
{
    const [mode, setMode] = useState('login'); // 'login' or 'register'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault(); // stop the browser reloading the page
        setError(null);
        setIsSubmitting(true);

        try
        {
            if (mode === 'register')
            {
                await register(email, password); // creates the account, but doesn't log in
            }
            const user = await login(email, password); // the server sets the httpOnly cookie
            onLoggedIn(user);
        }
        catch (err)
        {
            // Show the server's message as it is: it never says whether the email or the password was wrong
            setError(err.message);
            setIsSubmitting(false);
        }
    };

    const switchMode = () => {
        setMode(mode === 'login' ? 'register' : 'login');
        setError(null);
    };

    return(
        <main className="center-screen">
            <form onSubmit={handleSubmit} className="task-form auth-card">
                <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>

                {/* This form's own error wins; otherwise show App's notice */}
                {(error || notice) && <div className="error-message">{error || notice}</div>}

                <div className="field">
                    <label htmlFor="login-email">Email</label>
                    <input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </div>

                <div className="field">
                    <label htmlFor="login-password">Password</label>
                    <input
                        id="login-password"
                        type="password"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        minLength={mode === 'register' ? 8 : undefined}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </div>

                <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
                    {mode === 'login' ? 'Log in' : 'Register'}
                </button>

                {/* type="button": inside a form, a button without a type would submit the form */}
                <button type="button" className="btn btn-ghost link-button" onClick={switchMode}>
                    {mode === 'login' ? 'No account? Register' : 'Have an account? Log in'}
                </button>
            </form>
        </main>
    );
}

export default LoginForm;
