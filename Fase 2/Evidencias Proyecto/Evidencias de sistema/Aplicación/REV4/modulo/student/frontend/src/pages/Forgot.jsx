import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Logo } from '../components/ui.jsx';

export default function Forgot() {
  const { L, lang } = useAuth();

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
          {L('forgot_h')}
        </div>

        <div
          className="card flat"
          role="status"
          style={{ marginTop: 16, textAlign: 'center' }}
        >
          <p className="note" style={{ margin: 0 }}>
            {lang === 'en'
              ? 'Password recovery by email is unavailable in this version.'
              : 'La recuperación de contraseña por correo no está disponible en esta versión.'}
          </p>

          <p className="note" style={{ marginTop: 12 }}>
            {lang === 'en'
              ? 'If you cannot remember your password, ask the project administrator for assistance.'
              : 'Si no recuerdas tu contraseña, solicita ayuda al administrador del proyecto.'}
          </p>
        </div>

        <Link
          to="/login"
          className="btn full"
          style={{ marginTop: 16, textAlign: 'center' }}
        >
          {L('back_login')}
        </Link>
      </div>
    </div>
  );
}