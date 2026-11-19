import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Logo } from '../components/ui.jsx';

export default function Register() {
  const { L, lang, register } = useAuth();
  const nav = useNavigate();

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    consent: false,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox'
      ? event.target.checked
      : event.target.value;

    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (submittingRef.current || !form.consent) return;

    submittingRef.current = true;
    setErr('');
    setBusy(true);

    try {
      await register({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
      });
      nav('/onboarding');
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
          {L('reg_h')}
        </div>

        <p className="sub" style={{ textAlign: 'center' }}>
          {L('reg_sub')}
        </p>

        <form onSubmit={submit}>
          <label className="fld" htmlFor="register-name">
            {L('name')}
          </label>

          <input
            id="register-name"
            name="name"
            autoComplete="name"
            value={form.name}
            onChange={set('name')}
            disabled={busy}
            required
          />

          <label className="fld" htmlFor="register-email">
            {L('email')}
          </label>

          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="username"
            value={form.email}
            onChange={set('email')}
            disabled={busy}
            required
          />

          <label className="fld" htmlFor="register-password">
            {L('password')}
          </label>

          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            minLength={8}
            disabled={busy}
            required
          />

          <label
            className="flex"
            htmlFor="register-consent"
            style={{
              marginTop: 12,
              gap: 8,
              fontSize: 12.5,
              color: 'var(--muted)',
            }}
          >
            <input
              id="register-consent"
              name="consent"
              type="checkbox"
              style={{ width: 'auto' }}
              checked={form.consent}
              onChange={set('consent')}
              disabled={busy}
              required
            />
            {L('consent')}
          </label>

          {err && (
            <div className="err" role="alert">
              {err}
            </div>
          )}

          <button
            type="submit"
            className="btn full"
            style={{ marginTop: 14 }}
            disabled={busy || !form.consent}
          >
            {busy ? L('loading') : L('reg_btn')}
          </button>
        </form>

        <div className="or-sep">
          {lang === 'en' ? 'or' : 'o'}
        </div>

        <button
          type="button"
          className="paybtn google"
          disabled
          aria-describedby="register-social-note"
          style={{ opacity: 0.55, cursor: 'not-allowed' }}
        >
          {L('social_google')}
        </button>

        <p
          id="register-social-note"
          className="note"
          style={{ textAlign: 'center', marginTop: 10 }}
        >
          {lang === 'en'
            ? 'Google sign-up is unavailable in this version. Create your account with an email and password.'
            : 'El registro con Google no está disponible en esta versión. Crea tu cuenta con un correo y contraseña.'}
        </p>

        <p
          className="note"
          style={{ textAlign: 'center', marginTop: 16 }}
        >
          {L('have_account')}{' '}
          <Link to="/login" className="muted-link">
            {L('login_link')}
          </Link>
        </p>
      </div>
    </div>
  );
}