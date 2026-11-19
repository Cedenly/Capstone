import { sessionConfig } from './sessionConfig.js';

export function readRefreshCookie(req) {
  const found = String(req.headers.cookie || '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${sessionConfig.cookieName}=`));
  // Dos cookies del mismo nombre con distinto path/domain son ambiguas.
  if (found.length > 1) throw Object.assign(new Error('Cookie de sesión ambigua.'),
    { status: 400, code: 'AUTH_COOKIE_AMBIGUOUS' });
  if (!found.length) return null;
  const raw = found[0].slice(sessionConfig.cookieName.length + 1);
  if (!/^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(raw)) {
    throw Object.assign(new Error('Cookie de sesión malformada.'),
      { status: 400, code: 'AUTH_COOKIE_INVALID' });
  }
  return raw;
}

const cookieOptions = () => ({ httpOnly: true, secure: sessionConfig.secure,
  sameSite: sessionConfig.sameSite, path: sessionConfig.cookiePath });

export function setRefreshCookie(res, token, expiresAt) {
  res.set('Cache-Control', 'no-store');
  res.cookie(sessionConfig.cookieName, token, { ...cookieOptions(),
    maxAge: Math.max(0, expiresAt - Date.now()) });
}

export function clearRefreshCookie(res) {
  res.set('Cache-Control', 'no-store');
  res.clearCookie(sessionConfig.cookieName, cookieOptions());
}
