import { useState, useMemo } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { makeL, fmt } from './i18n.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Commercial from './pages/Commercial.jsx';
import Sponsors from './pages/Sponsors.jsx';
import Operations from './pages/Operations.jsx';
import Users from './pages/Users.jsx';
import Tutors from './pages/Tutors.jsx';
import Content from './pages/Content.jsx';
import Plans from './pages/Plans.jsx';
import Billing from './pages/Billing.jsx';

// Definición de las vistas: ruta, etiqueta, icono y roles que pueden verlas.
// Los roles replican el `requireRole` del backend para no ofrecer pantallas que
// el API rechazaría con 403 (admin siempre pasa).
export const VIEWS = [
  { id: 'resumen', path: '/', ic: '📊', group: 1, roles: ['admin', 'finance', 'ops', 'support'], el: Overview },
  { id: 'comercial', path: '/comercial', ic: '💰', group: 1, roles: ['finance'], el: Commercial },
  { id: 'sponsors', path: '/sponsors', ic: '🤝', group: 1, roles: ['finance'], el: Sponsors },
  { id: 'operativa', path: '/operativa', ic: '🛠️', group: 2, roles: ['ops'], el: Operations },
  { id: 'usuarios', path: '/usuarios', ic: '👥', group: 2, roles: ['support'], el: Users },
  { id: 'tutores', path: '/tutores', ic: '🎓', group: 2, roles: ['support'], el: Tutors },
  { id: 'contenido', path: '/contenido', ic: '📚', group: 2, roles: ['admin'], el: Content },
  { id: 'planes', path: '/planes', ic: '🧩', group: 2, roles: ['admin'], el: Plans },
  { id: 'facturacion', path: '/facturacion', ic: '💳', group: 1, roles: ['finance'], el: Billing },
];

export default function App() {
  const { user } = useAuth();
  const [lang, setLang] = useState('es');
  const [dark, setDark] = useState(false);
  const L = useMemo(() => makeL(lang), [lang]);
  const ctx = { L, lang, setLang, dark, setDark, fmt: (n) => fmt(n, lang) };

  if (!user) return <Login ctx={ctx} />;

  return (
    <Layout ctx={ctx}>
      <Routes>
        {VIEWS.map((v) => (
          <Route key={v.id} path={v.path} element={<Guard view={v} ctx={ctx} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function Guard({ view, ctx }) {
  const { canAccess } = useAuth();
  const loc = useLocation();
  if (!canAccess(view.roles)) {
    return <div className="card" style={{ marginTop: 8 }}><b>⛔ {ctx.L('no_access')}</b></div>;
  }
  const El = view.el;
  return <El ctx={ctx} key={loc.pathname} />;
}
