// Cliente HTTP del API. Maneja el envelope {data,error,meta}, el token Bearer
// y el refresh automático del access token.
const BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

let accessToken = null;
let refreshToken = null;
let onAuthFail = null;
let onTokens = null;

export function setTokens(a, r) { accessToken = a; refreshToken = r; }
export function setAuthFailHandler(fn) { onAuthFail = fn; }
// Permite a AuthContext persistir los tokens rotados por el refresh automático.
export function setTokensChangedHandler(fn) { onTokens = fn; }
export function getAccessToken() { return accessToken; }

async function raw(method, path, body, retry = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { data: null, meta: null };
  const json = await res.json().catch(() => ({ error: { code: 'PARSE', message: 'Respuesta inválida' } }));
  if (!res.ok) {
    // Intenta refrescar una vez si el access token expiró.
    if (res.status === 401 && retry && refreshToken && !path.startsWith('/admin/auth')) {
      const ok = await tryRefresh();
      if (ok) return raw(method, path, body, false);
      if (onAuthFail) onAuthFail();
    }
    const err = new Error(json.error?.message || 'Error');
    err.code = json.error?.code; err.status = res.status;
    throw err;
  }
  return json;
}

async function tryRefresh() {
  try {
    const res = await fetch(`${BASE}/admin/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    accessToken = json.data.accessToken; refreshToken = json.data.refreshToken;
    if (onTokens) onTokens(accessToken, refreshToken);
    return true;
  } catch { return false; }
}

// Construye un query-string omitiendo valores vacíos: el backend interpreta la
// ausencia del parámetro como "sin filtro".
export function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  login: (email, password, otp) => raw('POST', '/admin/auth/login', { email, password, otp }),
  get: (path) => raw('GET', '/admin' + path),
  post: (path, body) => raw('POST', '/admin' + path, body),
  patch: (path, body) => raw('PATCH', '/admin' + path, body),
  put: (path, body) => raw('PUT', '/admin' + path, body),
  del: (path) => raw('DELETE', '/admin' + path),
};
