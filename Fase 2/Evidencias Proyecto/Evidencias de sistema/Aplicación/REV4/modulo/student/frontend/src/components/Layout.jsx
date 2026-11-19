import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Logo, initials } from './ui.jsx';

const NAV_MAIN = [
  ['inicio', '\u{1F3E0}', '/'],
  ['practicar', '✏️', '/practicar'],
  ['medallas', '\u{1F3C5}', '/medallas'],
  ['grupos', '\u{1F465}', '/grupos'],
  ['comunidad', '\u{1F4AC}', '/comunidad'],
];
const NAV_ACCOUNT = [
  ['plan', '\u{1F4B3}', '/plan'],
  ['ajustes', '⚙️', '/ajustes'],
];

export default function Layout() {
  const { user, lang, setLang, dark, toggleTheme, L } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const free = user?.plan === 'free';

  const titleKey = ([...NAV_MAIN, ...NAV_ACCOUNT].find(([, , path]) => path === loc.pathname)?.[0]) || 'inicio';

  const Item = ([id, ic, path]) => (
    <NavLink key={id} to={path} end={path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'act' : ''}`} onClick={() => setOpen(false)}>
      <span className="ico">{ic}</span>{L('nav_' + id)}
      {id === 'plan' && free ? <span className="badge">PRO</span> : null}
    </NavLink>
  );

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="side-logo" style={{ color: '#fff' }}><Logo /> Aprueba</div>
        <nav className="nav">
          <div className="nav-sec">{L('nav_main')}</div>
          {NAV_MAIN.map(Item)}
          <div className="nav-sec">{L('nav_account')}</div>
          {NAV_ACCOUNT.map(Item)}
        </nav>
        <div className="side-foot">
          <div className="side-user" onClick={() => { nav('/ajustes'); setOpen(false); }}>
            <div className="side-avatar">{initials(user?.name)}</div>
            <div>
              <div className="nm">{user?.name}</div>
              <div className="pl">
                {free
                  ? L('plan_free')
                  : user?.plan === 'uni'
                    ? lang === 'en'
                      ? '1 unlimited test'
                      : '1 prueba ilimitada'
                    : lang === 'en'
                      ? 'All tests'
                      : 'Todas las pruebas'}
              </div>
            </div>
          </div>
        </div>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main-wrap">
        <header className="topbar">
          <button className="hamb" onClick={() => setOpen(true)}>☰</button>
          <div className="page-title">{L('nav_' + titleKey)}</div>
          <div className="search"><input placeholder={L('search_ph')} /></div>
          <div className="tb-right">
            <span className="chip">{"\u{1F525}"} {user?.streak || 0}</span>
            <select className="ctl" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="es">ES</option><option value="en">EN</option>
            </select>
            <button className="ctl" onClick={toggleTheme}>{dark ? '☀️' : '\u{1F319}'}</button>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
