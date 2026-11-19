import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Logo } from '../components/ui.jsx';

export default function Login() {
  const { L, lang, login } = useAuth();
  const nav = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const submit = async (event) => {
    event.preventDefault();

    if (submittingRef.current) return;

    submittingRef.current = true;
    setErr('');
    setBusy(true);

    try {
      const user = await login(email.trim(), password);
      nav(user.onboarded ? '/' : '/onboarding');
    } catch (error) {
      setErr(error.message);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div
          className="auth-logo"
          style={{ color: 'var(--brand)' }}
        >
          <Logo size={28} /> Aprueba
        </div>

        <div className="h" style={{ textAlign: 'center' }}>
          {L('login_h')}
        </div>

        <p className="sub" style={{ textAlign: 'center' }}>
          {L('login_sub')}
        </p>

        <form onSubmit={submit}>
          <label className="fld" htmlFor="login-email">
            {L('email')}
          </label>

          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            required
          />

          <label className="fld" htmlFor="login-password">
            {L('password')}
          </label>

          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            required
          />

          {err && (
            <div className="err" role="alert">
              {err}
            </div>
          )}

          <button
            type="submit"
            className="btn full"
            style={{ marginTop: 16 }}
            disabled={busy}
          >
            {busy ? L('loading') : L('login_btn')}
          </button>
        </form>

        <div className="or-sep">
          {lang === 'en' ? 'or' : 'o'}
        </div>

        <button
          type="button"
          className="paybtn google"
          disabled
          aria-describedby="login-social-note"
          style={{ opacity: 0.55, cursor: 'not-allowed' }}
        >
          {L('social_google')}
        </button>

        <button
          type="button"
          className="paybtn apple"
          disabled
          aria-describedby="login-social-note"
          style={{ opacity: 0.55, cursor: 'not-allowed' }}
        >
          {L('social_apple')}
        </button>

        <p
          id="login-social-note"
          className="note"
          style={{ textAlign: 'center', marginTop: 10 }}
        >
          {lang === 'en'
            ? 'Google and Apple sign-in are unavailable in this version. Use your email and password.'
            : 'El acceso con Google y Apple no está disponible en esta versión. Utiliza tu correo y contraseña.'}
        </p>

        <p
          className="note"
          style={{ textAlign: 'center', marginTop: 16 }}
        >
          <Link to="/forgot" className="muted-link">
            {L('forgot_link')}
          </Link>
        </p>

        <p className="note" style={{ textAlign: 'center' }}>
          {L('no_account')}{' '}
          <Link to="/register" className="muted-link">
            {L('register_link')}
          </Link>
        </p>
      </div>
    </div>
  );
}