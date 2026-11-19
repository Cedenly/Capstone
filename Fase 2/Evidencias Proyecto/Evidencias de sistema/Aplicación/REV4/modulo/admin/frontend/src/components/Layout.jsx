import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { VIEWS } from '../App.jsx';

const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 30 30" fill="none">
    <polygon points="3,27 9,6 13,6 8,27" fill="#fff" /><polygon points="27,27 21,6 17,6 22,27" fill="#fff" />
    <rect x="7" y="14" width="16" height="4" rx="1" fill="#fff" /><rect x="12" y="14" width="6" height="10" rx="1" fill="#F5B041" />
    <polygon points="15,5 12,10 18,10" fill="#F5B041" />
  </svg>
);

export default function Layout({ ctx, children }) {
  const { L, lang, setLang, dark, setDark } = ctx;
  const { user, logout, canAccess } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const current = VIEWS.find((v) => v.path === loc.pathname) || VIEWS[0];
  const initials = (user.name || 'AD').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  // Solo se muestran en el menú las vistas que el rol puede ver.
  const visible = VIEWS.filter((v) => canAccess(v.roles));
  const grp1 = visible.filter((v) => v.group === 1);
  const grp2 = visible.filter((v) => v.group === 2);

  const NavItem = (v) => (
    <NavLink key={v.id} to={v.path} end={v.path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'act' : ''}`} onClick={() => setOpen(false)}>
      <span className="ico">{v.ic}</span>{L('nav_' + v.id)}
    </NavLink>
  );

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="side-logo"><Logo /><div>Aprueba<small>{L('console')}</small></div></div>
        <nav className="nav">
          {grp1.length > 0 && <div className="nav-sec">{L('nav_grp1')}</div>}
          {grp1.map(NavItem)}
          {grp2.length > 0 && <div className="nav-sec">{L('nav_grp2')}</div>}
          {grp2.map(NavItem)}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <div className="side-avatar">{initials}</div>
            <div><div className="nm">{user.name}</div><div className="rl">{L('role_' + user.role)}</div></div>
          </div>
          <button className="side-logout" onClick={logout}>{L('logout')}</button>
        </div>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main-wrap">
        <header className="topbar">
          <button className="hamb" onClick={() => setOpen(true)}>☰</button>
          <div className="page-title">{L('nav_' + current.id)}</div>
          <div className="tb-right">
            <select className="ctl" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="es">🌐 ES</option><option value="en">🌐 EN</option>
            </select>
            <button className="ctl" onClick={() => { setDark(!dark); document.body.classList.toggle('dark', !dark); }}>{dark ? '☀️' : '🌙'}</button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
