import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';

import {
  api,
  authenticate,
  restoreSession,
  logoutSession,
  getSessionVersion,
  clearTokens,
  setAuthFailHandler,
} from '../api/client.js';

import { makeL } from '../i18n.js';

const Ctx = createContext(null);

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [lang, setLang] = useState(
    localStorage.getItem('aprueba_lang') || 'es'
  );
  const [dark, setDark] = useState(
    localStorage.getItem('aprueba_dark') === '1'
  );
  const [loading, setLoading] = useState(true);

  const L = makeL(lang);

  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    localStorage.setItem('aprueba_dark', dark ? '1' : '0');
  }, [dark]);

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem('aprueba_lang', lang);
  }, [lang]);

  const logout = useCallback(async () => {
    const expectedVersion = getSessionVersion() + 1;
    await logoutSession();
    if (getSessionVersion() === expectedVersion) setUser(null);
  }, []);

  useEffect(() => {
    setAuthFailHandler(() => setUser(null));
    return () => setAuthFailHandler(null);
  }, []);

  const loadMe = useCallback(async () => {
    const expectedVersion = getSessionVersion();
    try {
      if (!await restoreSession()) return;
      if (getSessionVersion() !== expectedVersion) return;
      const { data } = await api.get('/me');
      if (getSessionVersion() !== expectedVersion) return;
      setUser(data);

      try {
        const settings = (await api.get('/me/settings')).data;
        if (getSessionVersion() !== expectedVersion) return;
        if (settings.locale) setLang(settings.locale);
        if (settings.theme) setDark(settings.theme === 'dark');
        const onboarded = (settings.selectedTests || []).length > 0;
        setUser({ ...data, onboarded });
      } catch {}
    } catch {
      if (getSessionVersion() === expectedVersion) {
        clearTokens();
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const afterAuth = useCallback(async (payload, expectedVersion) => {
    const assertCurrent = () => {
      if (getSessionVersion() !== expectedVersion) {
        throw Object.assign(new Error('La sesion cambio. Vuelve a iniciar sesion.'), {
          code: 'SESSION_CHANGED', status: 401,
        });
      }
    };
    assertCurrent();
    let onboarded = !!payload.user?.onboarded;
    try {
      const settings = (await api.get('/me/settings')).data;
      assertCurrent();
      onboarded = (settings.selectedTests || []).length > 0;
      if (settings.locale) setLang(settings.locale);
      if (settings.theme) setDark(settings.theme === 'dark');
    } catch {
      assertCurrent();
    }
    const me = (await api.get('/me')).data;
    assertCurrent();
    const authenticatedUser = { ...me, onboarded };
    setUser(authenticatedUser);
    return authenticatedUser;
  }, []);

  const login = async (email, password) => {
    const pending = authenticate('/auth/login', { email, password });
    const expectedVersion = getSessionVersion();
    const response = await pending;
    return afterAuth(response.data, expectedVersion);
  };

  const register = async body => {
    const pending = authenticate('/auth/register', body);
    const expectedVersion = getSessionVersion();
    const response = await pending;
    return afterAuth(response.data, expectedVersion);
  };

  // Mantiene la función para consumidores anteriores.
  // El acceso social requiere una integración real con el proveedor.
  const social = async () => {
    throw Object.assign(
      new Error(
        lang === 'en'
          ? 'Google and Apple sign-in are unavailable in this version. Use your email and password.'
          : 'El acceso con Google y Apple no está disponible en esta versión. Utiliza tu correo y contraseña.'
      ),
      { code: 'SOCIAL_AUTH_UNAVAILABLE' }
    );
  };

  const refreshUser = useCallback(async () => {
    const expectedVersion = getSessionVersion();
    try {
      const me = (await api.get('/me')).data;
      if (getSessionVersion() !== expectedVersion) return;

      setUser((current) => ({
        ...current,
        ...me,
      }));

      return me;
    } catch {}
  }, []);

  const toggleTheme = async () => {
    const nextDark = !dark;
    setDark(nextDark);

    try {
      await api.patch('/me/settings', {
        theme: nextDark ? 'dark' : 'light',
      });
    } catch {}
  };

  const changeLang = async (language) => {
    setLang(language);

    try {
      await api.patch('/me/settings', {
        locale: language,
      });
    } catch {}
  };

  return (
    <Ctx.Provider
      value={{
        user,
        setUser,
        lang,
        setLang: changeLang,
        dark,
        toggleTheme,
        L,
        loading,
        login,
        register,
        social,
        logout,
        refreshUser,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}