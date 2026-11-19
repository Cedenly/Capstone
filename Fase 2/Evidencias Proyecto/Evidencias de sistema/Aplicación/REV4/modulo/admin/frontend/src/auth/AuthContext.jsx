import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setTokens, setAuthFailHandler, setTokensChangedHandler } from '../api/client.js';

const AuthCtx = createContext(null);
const STORE = 'aprueba_admin_session';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) || 'null');
      if (s) { setTokens(s.accessToken, s.refreshToken); return s.user; }
    } catch { /* ignore */ }
    return null;
  });

  const logout = useCallback(() => {
    setUser(null); setTokens(null, null); sessionStorage.removeItem(STORE);
  }, []);

  useEffect(() => { setAuthFailHandler(logout); }, [logout]);

  // Cuando el cliente rota los tokens (refresh automático) hay que persistirlos,
  // o al recargar la pestaña se restauraría el par ya caducado.
  useEffect(() => {
    setTokensChangedHandler((accessToken, refreshToken) => {
      try {
        const s = JSON.parse(sessionStorage.getItem(STORE) || 'null');
        if (s) sessionStorage.setItem(STORE, JSON.stringify({ ...s, accessToken, refreshToken }));
      } catch { /* ignore */ }
    });
  }, []);

  const login = useCallback(async (email, password, otp) => {
    const { data } = await api.login(email, password, otp);
    setTokens(data.accessToken, data.refreshToken);
    sessionStorage.setItem(STORE, JSON.stringify(data));
    setUser(data.user);
    return data.user;
  }, []);

  // Comprueba si el rol del usuario puede ver una sección.
  const canAccess = useCallback((roles) => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return roles.includes(user.role);
  }, [user]);

  // Igual que `requireRole` del backend: admin siempre pasa. Se usa para ocultar
  // acciones que el API rechazaría con 403 (p. ej. el borrado definitivo).
  const hasRole = useCallback((...roles) => {
    if (!user) return false;
    return user.role === 'admin' || roles.includes(user.role);
  }, [user]);

  const isAdmin = user?.role === 'admin';

  return (
    <AuthCtx.Provider value={{ user, login, logout, canAccess, hasRole, isAdmin }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
